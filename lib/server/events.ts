import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { LogEntry, LogKind, LogLevel } from "../types";

const MAX_IN_MEMORY = 5_000;

/** Append-only event log behind the dashboard's Backlog. Stored as JSON lines on the ATOM. */
export class EventLog {
  private entries: LogEntry[] = [];
  private nextId = Date.now();
  private readonly file: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, "events.jsonl");
    this.load();
  }

  add(entry: {
    kind: LogKind;
    message: string;
    level?: LogLevel;
    source?: string | null;
    camera?: string | null;
    snapshot?: string | null;
    data?: Record<string, unknown> | null;
  }): LogEntry {
    const full: LogEntry = {
      id: this.nextId++,
      ts: Date.now(),
      level: entry.level ?? "info",
      kind: entry.kind,
      source: entry.source ?? null,
      camera: entry.camera ?? null,
      message: entry.message,
      snapshot: entry.snapshot ?? null,
      data: entry.data ?? null,
    };
    this.entries.push(full);
    if (this.entries.length > MAX_IN_MEMORY) this.entries.splice(0, this.entries.length - MAX_IN_MEMORY);
    try {
      fs.appendFileSync(this.file, JSON.stringify(full) + "\n");
    } catch (err) {
      console.error("[sentry] could not write event log", err);
    }
    return full;
  }

  /** Newest first. With `afterId`, only entries newer than that ID. */
  list({ afterId = 0, limit = 200, kinds }: { afterId?: number; limit?: number; kinds?: LogKind[] } = {}): LogEntry[] {
    const out: LogEntry[] = [];
    for (let i = this.entries.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.entries[i];
      if (e.id <= afterId) break;
      if (!kinds || kinds.includes(e.kind)) out.push(e);
    }
    return out;
  }

  private load(): void {
    if (!fs.existsSync(this.file)) return;
    const lines = fs.readFileSync(this.file, "utf8").split("\n").filter(Boolean);
    for (const line of lines.slice(-MAX_IN_MEMORY)) {
      try {
        const entry = JSON.parse(line) as LogEntry;
        this.entries.push({ ...entry, camera: entry.camera ?? null }); // older entries have no camera
      } catch {
        // Skip a partially written line.
      }
    }
    // Seeding from the clock keeps IDs increasing even if the data folder is wiped,
    // so an open dashboard never misses new entries after a restart.
    this.nextId = Math.max((this.entries.at(-1)?.id ?? 0) + 1, Date.now());
  }
}
