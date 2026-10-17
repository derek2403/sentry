import "server-only";

import path from "node:path";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function callMode(raw: string | undefined): "on" | "simulate" | "off" {
  const value = raw?.trim().toLowerCase() || "off";
  if (value === "on" || value === "simulate" || value === "off") return value;
  throw new Error(`EMERGENCY_CALLS must be on, simulate or off, got "${raw}"`);
}

export const config = {
  llm: {
    // The vLLM server already running on the ATOM (OpenAI-compatible).
    baseUrl: (process.env.LLM_BASE_URL || "http://localhost:8000/v1").replace(/\/+$/, ""),
    // Leave empty to use the first model the endpoint serves.
    model: process.env.LLM_MODEL || "",
    apiKey: process.env.LLM_API_KEY || "",
    timeoutMs: num("LLM_TIMEOUT_MS", 30_000),
    maxTokens: num("LLM_MAX_TOKENS", 300),
    // Ask reasoning-capable Nemotron models to answer directly (faster per frame).
    disableThinking: bool("LLM_DISABLE_THINKING", true),
    // Use vLLM guided decoding so the reply is always valid JSON.
    jsonSchema: bool("LLM_JSON_SCHEMA", true),
  },
  analysis: {
    // Seconds of video between analysed frames.
    intervalS: num("ANALYSIS_INTERVAL_S", 0.5),
    maxFrameWidth: num("FRAME_MAX_WIDTH", 768),
    // After a video ends, keep analysing its last frame this long so a fall
    // right at the end can still be confirmed.
    holdLastFrameS: num("HOLD_LAST_FRAME_S", 8),
  },
  fall: {
    confirmFrames: num("FALL_CONFIRM_FRAMES", 2),
    confirmSeconds: num("FALL_CONFIRM_SECONDS", 2),
    recoverFrames: num("FALL_RECOVER_FRAMES", 2),
    minConfidence: num("FALL_MIN_CONFIDENCE", 0.5),
    candidateTimeoutS: num("FALL_CANDIDATE_TIMEOUT_S", 10),
  },
  calls: {
    // What a confirmed fall does with Bryan's call service (python -m sentry_calls):
    //   on       place a real call to EMERGENCY_CONTACT_PHONE
    //   simulate print the call script only (no phone call)
    //   off      do nothing
    mode: callMode(process.env.EMERGENCY_CALLS),
    // Seconds to wait before calling; pressing Mark OK in that time cancels the call.
    delayS: num("EMERGENCY_CALL_DELAY_S", 0),
    // Python with requirements-calls.txt installed. Defaults to .venv/bin/python, then python3.
    python: process.env.CALLS_PYTHON || "",
    timeoutMs: num("EMERGENCY_CALL_TIMEOUT_MS", 60_000),
  },
  cameraName: process.env.CAMERA_NAME || "Living room",
  // Runtime data (event log, snapshots): not part of the build output.
  dataDir: path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || "data"),
};
