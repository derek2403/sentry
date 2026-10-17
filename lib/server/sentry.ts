import "server-only";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Alert, FrameResult, FrameVerdict, SessionInfo, SourceKind } from "../types";
import { config } from "./config";
import { EventLog } from "./events";
import { FallDetector } from "./fall";
import { analyseFrame } from "./nemotron";
import { onFallConfirmed } from "./workflow";

const SESSION_IDLE_MS = 5 * 60_000;

interface Session extends SessionInfo {
  detector: FallDetector;
  previous: FrameVerdict | null;
  frames: number;
  busy: boolean;
  failing: boolean;
  ended: boolean;
  lastSeen: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** All server-side state: one instance per server process. */
class Sentry {
  readonly log = new EventLog(config.dataDir);
  readonly snapshotDir = path.join(config.dataDir, "snapshots");
  private sessions = new Map<string, Session>();
  private alert: Alert | null = null;

  constructor() {
    fs.mkdirSync(this.snapshotDir, { recursive: true });
    this.log.add({ kind: "system", message: "Sentry server started" });
  }

  currentAlert(): Alert | null {
    return this.alert;
  }

  activeSessions(): number {
    return this.sessions.size;
  }

  acknowledgeAlert(): Alert | null {
    const alert = this.alert;
    if (alert) {
      this.alert = null;
      this.log.add({ kind: "alert", source: alert.location, message: "Alert acknowledged on the dashboard" });
    }
    return alert;
  }

  startSession(source: SourceKind, name: string): SessionInfo {
    this.pruneIdle();
    const session: Session = {
      id: randomUUID(),
      source,
      name,
      detector: new FallDetector(config.fall),
      previous: null,
      frames: 0,
      busy: false,
      failing: false,
      ended: false,
      lastSeen: Date.now(),
    };
    this.sessions.set(session.id, session);
    this.log.add({
      kind: "video",
      source: this.location(session),
      message: source === "upload" ? `Started analysing uploaded video "${name}"` : `Live camera "${name}" connected`,
    });
    return { id: session.id, source, name };
  }

  endSession(id: string, reason: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.ended = true; // a frame still waiting on Nemotron must not raise alerts afterwards
    this.sessions.delete(id);
    this.log.add({
      kind: "video",
      source: this.location(session),
      message: `${session.source === "upload" ? `Finished "${session.name}"` : "Camera disconnected"} (${reason}). ${session.frames} frames analysed.`,
    });
  }

  async analyse(id: string, imageDataUrl: string, t: number): Promise<FrameResult> {
    const session = this.sessions.get(id);
    if (!session) throw new HttpError(404, "Unknown or expired session");
    if (session.busy) throw new HttpError(409, "Previous frame is still being analysed");
    session.busy = true;
    session.lastSeen = Date.now();
    const location = this.location(session);
    const started = performance.now();

    try {
      let verdict: FrameVerdict;
      try {
        verdict = await analyseFrame({ imageDataUrl, t, source: location, previous: session.previous });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!session.failing) {
          // Log once per outage, not on every frame.
          this.log.add({ kind: "error", level: "error", source: location, message: `Nemotron analysis failed: ${message}` });
          session.failing = true;
        }
        return { verdict: null, state: session.detector.state, events: [], latencyMs: Math.round(performance.now() - started), error: message, alert: this.alert };
      }
      if (session.ended) {
        return { verdict, state: session.detector.state, events: [], latencyMs: Math.round(performance.now() - started), alert: this.alert };
      }
      if (session.failing) {
        session.failing = false;
        this.log.add({ kind: "system", source: location, message: "Nemotron analysis recovered" });
      }

      const latencyMs = Math.round(performance.now() - started);
      session.frames += 1;
      session.previous = verdict;
      const { state, events } = session.detector.update(verdict, t);

      this.log.add({
        kind: "frame",
        source: location,
        message: `${formatTime(t)} · ${verdict.person_visible ? verdict.posture : "no person"}${verdict.fall_detected ? " · FALL" : ""} · ${verdict.description}`,
        data: { t, latencyMs, ...verdict },
      });

      for (const event of events) {
        const data = { t, confidence: verdict.confidence };
        const detail = event.detail.replace(/[.\s]+$/, "");
        if (event.kind === "possible_fall") {
          this.log.add({ kind: event.kind, level: "warning", source: location, data, message: `Possible fall at ${formatTime(t)}: ${detail}. Confirming with the next frames.` });
        } else if (event.kind === "fall_cancelled") {
          this.log.add({ kind: event.kind, source: location, data, message: `False alarm at ${formatTime(t)}: ${detail}.` });
        } else if (event.kind === "recovered") {
          this.log.add({ kind: event.kind, source: location, data, message: `Recovered at ${formatTime(t)}: ${detail}.` });
        } else if (event.kind === "fall_confirmed") {
          this.raiseAlert(location, t, detail, imageDataUrl);
        }
      }

      return { verdict, state, events, latencyMs, alert: this.alert };
    } finally {
      session.busy = false;
    }
  }

  private raiseAlert(location: string, t: number, detail: string, imageDataUrl: string): void {
    const snapshot = this.saveSnapshot(imageDataUrl);
    const entry = this.log.add({
      kind: "fall_confirmed",
      level: "critical",
      source: location,
      snapshot,
      data: { t },
      message: `FALL DETECTED in ${location} at ${formatTime(t)}: ${detail}`,
    });
    this.alert = { eventId: entry.id, ts: entry.ts, location, message: entry.message, snapshot, videoTime: t };
    // Don't hold up the frame response while the workflow runs.
    onFallConfirmed(this.alert, this.log).catch((err) => {
      this.log.add({ kind: "error", level: "error", source: location, message: `Emergency workflow failed: ${err instanceof Error ? err.message : String(err)}` });
    });
  }

  private saveSnapshot(imageDataUrl: string): string | null {
    const match = /^data:image\/jpeg;base64,(.+)$/.exec(imageDataUrl);
    if (!match) return null;
    const name = `${randomUUID()}.jpg`;
    try {
      fs.writeFileSync(path.join(this.snapshotDir, name), Buffer.from(match[1], "base64"));
      return `/api/snapshots/${name}`;
    } catch (err) {
      console.error("[sentry] could not save snapshot", err);
      return null;
    }
  }

  private location(session: SessionInfo): string {
    return session.source === "camera" ? session.name : `${config.cameraName} (uploaded video)`;
  }

  private pruneIdle(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastSeen > SESSION_IDLE_MS) this.endSession(id, "idle timeout");
    }
  }
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

// One instance per server process. It lives on globalThis because Next.js bundles each
// route handler separately (each with its own copy of this module) and `next dev` reloads
// modules on edit; both would otherwise create separate instances with separate sessions.
// After editing lib/server/* or .env.local, restart the server to pick up the changes.
const globalForSentry = globalThis as unknown as { __sentry?: Sentry };

export function sentry(): Sentry {
  globalForSentry.__sentry ??= new Sentry();
  return globalForSentry.__sentry;
}
