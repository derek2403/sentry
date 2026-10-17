"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LogEntry, LogKind } from "@/lib/types";

import { CloseIcon } from "./icons";

const POLL_MS = 1_500;
const MAX_ENTRIES = 1_000;

type Filter = "all" | "events" | "frames";

const KIND_LABELS: Record<LogKind, string> = {
  system: "System",
  video: "Video",
  frame: "Frame",
  error: "Error",
  workflow: "Workflow",
  alert: "Alert",
  possible_fall: "Possible fall",
  fall_confirmed: "Fall confirmed",
  fall_cancelled: "False alarm",
  recovered: "Recovered",
};

const LEVEL_STYLES = {
  info: "bg-muted",
  warning: "bg-warn",
  critical: "bg-danger",
  error: "bg-danger",
} as const;

interface Props {
  open: boolean;
  onClose: () => void;
  onUnreadChange: (count: number) => void;
}

export default function BacklogDrawer({ open, onClose, onUnreadChange }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [seenId, setSeenId] = useState(0);
  const lastId = useRef(0);
  const loaded = useRef(false);

  // Poll for new entries, whether or not the drawer is open, so the unread badge stays current.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/logs?after=${lastId.current}&limit=500`, { cache: "no-store" });
        if (res.ok) {
          const { entries: fresh } = (await res.json()) as { entries: LogEntry[] };
          if (!cancelled && fresh.length > 0) {
            lastId.current = fresh[0].id;
            setEntries((old) => [...fresh, ...old].slice(0, MAX_ENTRIES));
          }
          if (!cancelled && !loaded.current) {
            // History from before this page was opened doesn't count as unread.
            loaded.current = true;
            setSeenId(lastId.current);
          }
        }
      } catch {
        // Server unreachable: try again on the next tick.
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // While open everything counts as read; closing remembers how far the user got.
  const newestId = entries[0]?.id ?? 0;
  const close = useCallback(() => {
    setSeenId(newestId);
    onClose();
  }, [newestId, onClose]);

  const unread = useMemo(
    () => (open ? 0 : entries.filter((e) => e.id > seenId && e.level !== "info").length),
    [open, entries, seenId],
  );
  useEffect(() => onUnreadChange(unread), [unread, onUnreadChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const visible = entries.filter((e) => (filter === "all" ? true : filter === "frames" ? e.kind === "frame" : e.kind !== "frame"));

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={close}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-line bg-panel shadow-2xl transition-transform ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="Backlog"
        aria-hidden={!open}
        inert={!open}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="font-medium">Backlog</h2>
            <p className="text-xs text-muted">Every frame verdict and event, stored locally on the ATOM</p>
          </div>
          <button type="button" onClick={close} className="rounded-lg p-2 hover:bg-panel-2" aria-label="Close backlog">
            <CloseIcon className="size-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-line px-4 py-2">
          {(["all", "events", "frames"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 text-sm capitalize ${filter === f ? "bg-panel-2 text-text" : "text-muted hover:text-text"}`}
            >
              {f}
            </button>
          ))}
          <span className="ml-auto self-center text-xs text-muted">{visible.length} entries</span>
        </div>

        <ol className="flex-1 overflow-y-auto">
          {visible.length === 0 && <li className="px-4 py-6 text-sm text-muted">Nothing logged yet.</li>}
          {visible.map((e) => (
            <li key={e.id} className={`flex gap-3 border-b border-line/60 px-4 py-3 ${e.level === "critical" ? "bg-danger/10" : ""}`}>
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${LEVEL_STYLES[e.level]}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span className="font-mono">{new Date(e.ts).toLocaleTimeString()}</span>
                  <span className="rounded bg-panel-2 px-1.5 py-0.5">{KIND_LABELS[e.kind] ?? e.kind}</span>
                  {e.source && <span className="truncate">{e.source}</span>}
                </div>
                <p className="mt-1 text-sm break-words">{e.message}</p>
                {e.kind === "frame" && typeof e.data?.latencyMs === "number" && (
                  <p className="mt-0.5 font-mono text-[11px] text-muted">
                    {Math.round(Number(e.data.confidence ?? 0) * 100)}% confidence · {e.data.latencyMs} ms
                  </p>
                )}
                {e.snapshot && (
                  <a href={e.snapshot} target="_blank" rel="noreferrer" className="mt-2 block">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local snapshot served by our own API */}
                    <img src={e.snapshot} alt="Snapshot at the time of the event" className="max-h-40 rounded-md border border-line" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      </aside>
    </>
  );
}
