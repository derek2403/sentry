import "server-only";

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { Alert } from "../types";
import { config } from "./config";
import type { EventLog } from "./events";

// Only one call at a time, across hot reloads.
const state = globalThis as unknown as { __sentryCallRunning?: boolean };

/**
 * Emergency workflow, run once per confirmed fall: calls the emergency contact with
 * Bryan's call service (sentry_calls). The call explains what happened, reads the
 * first-aid checklist and asks whether to call emergency services (a teammate in the demo).
 *
 * The call is started locally through the sentry_calls CLI, the same way as
 * `python -m sentry_calls call`, so there is no public endpoint that can start calls.
 * `python -m sentry_calls serve` and the HTTPS tunnel must be running for Twilio's callbacks.
 */
export async function onFallConfirmed(alert: Alert, log: EventLog, isStillActive: () => boolean): Promise<void> {
  const { mode, delayS } = config.calls;
  const where = { source: alert.location, camera: alert.camera };

  if (mode === "off") {
    log.add({ kind: "workflow", ...where, message: "Emergency call skipped (EMERGENCY_CALLS=off)" });
    return;
  }

  if (delayS > 0) {
    log.add({ kind: "workflow", level: "warning", ...where, message: `Calling the emergency contact in ${delayS}s unless someone marks this OK` });
    await new Promise((resolve) => setTimeout(resolve, delayS * 1000));
    if (!isStillActive()) {
      log.add({ kind: "workflow", ...where, message: "Emergency call cancelled: the alert was marked OK" });
      return;
    }
  }

  if (state.__sentryCallRunning) {
    log.add({ kind: "workflow", level: "warning", ...where, message: "Emergency call not started: another call is still being placed" });
    return;
  }
  state.__sentryCallRunning = true;
  try {
    if (mode === "on") {
      const problem = await callServiceProblem();
      if (problem) throw new Error(`${problem} No call was placed.`);
    }
    const command = mode === "on" ? "call" : "simulate";
    log.add({
      kind: "workflow",
      level: "warning",
      ...where,
      message:
        mode === "on"
          ? "Nemotron is writing the call script, then Sentry calls the emergency contact"
          : "Simulating the emergency call (EMERGENCY_CALLS=simulate, no phone call)",
    });
    // What the call is about. Nemotron writes the call from this (sentry_calls/script.py).
    const incident = {
      type: alert.type,
      description: alert.description,
      location: alert.location.replace(/^\d+[A-Z]?\s+/, ""), // "1A Living room" -> "Living room"
      detected_at: new Date(alert.ts).toISOString(),
    };
    const result = await runCalls(command, JSON.stringify(incident));
    const output = (result.stdout || result.stderr).trim();
    const script = parseScript(result.stdout);
    if (script) {
      log.add({
        kind: "workflow",
        ...where,
        message:
          script.source === "nemotron"
            ? `Nemotron wrote the call: "${script.intro} ${script.guidance}"`
            : `Fixed call script used (${script.note ?? "Nemotron unavailable"}): "${script.intro}"`,
        data: { script },
      });
    }
    if (result.code !== 0) {
      throw new Error(output.split("\n").at(-1) || `sentry_calls exited with code ${result.code}`);
    }
    log.add({
      kind: "workflow",
      level: mode === "on" ? "critical" : "info",
      ...where,
      message: mode === "on" ? output.split("\n").at(-1) || "Emergency contact call submitted" : "Simulated call script generated (see data)",
      data: { command: `python -m sentry_calls ${command}`, output: output.slice(0, 4000) },
    });
  } finally {
    state.__sentryCallRunning = false;
  }
}

/**
 * Twilio needs the callback server (python -m sentry_calls serve, port 5050) behind the public
 * tunnel, or the call rings and then fails. Returns what is wrong, or null if both answer.
 */
async function callServiceProblem(): Promise<string | null> {
  try {
    await fetch("http://127.0.0.1:5050/", { signal: AbortSignal.timeout(2_000) });
  } catch {
    return "The call service isn't running: start `npm run calls:serve`.";
  }
  const publicUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!publicUrl) return "PUBLIC_BASE_URL is not set in .env.";
  try {
    const res = await fetch(`${publicUrl}/`, { signal: AbortSignal.timeout(5_000), headers: { "ngrok-skip-browser-warning": "1" } });
    const body = await res.text();
    if (body.includes("ERR_NGROK")) return `The tunnel at ${publicUrl} is offline: start ngrok for port 5050.`;
  } catch {
    return `Can't reach ${publicUrl}: start the HTTPS tunnel for port 5050.`;
  }
  return null;
}

function pythonPath(): string {
  if (config.calls.python) return config.calls.python;
  const venv = path.join(process.cwd(), ".venv", "bin", "python");
  return fs.existsSync(venv) ? venv : "python3";
}

interface CallScript {
  intro: string;
  guidance: string;
  summary: string;
  source: "nemotron" | "template";
  note?: string;
}

/** The `script: {...}` line sentry_calls prints with the script it will speak. */
function parseScript(stdout: string): CallScript | null {
  const line = stdout.split("\n").find((l) => l.startsWith("script: "));
  if (!line) return null;
  try {
    return JSON.parse(line.slice("script: ".length)) as CallScript;
  } catch {
    return null;
  }
}

function runCalls(command: "call" | "simulate", incident: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // The child gets this server's environment, so the Twilio, number and Nemotron (LLM_*)
    // settings can live in .env or .env.local; sentry_calls also loads .env itself.
    // Arguments are passed as an array (no shell), so the incident text can't inject commands.
    const child = spawn(pythonPath(), ["-m", "sentry_calls", command, "--incident", incident], { cwd: process.cwd(), env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), config.calls.timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not run sentry_calls with ${pythonPath()}: ${err.message}. Install requirements-calls.txt into .venv.`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
