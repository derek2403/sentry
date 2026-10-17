"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { CAMERA_BY_ID, cameraLabel, type Camera } from "@/lib/client/cameras";
import { useDraggable, useMinimised } from "@/lib/client/panels";
import type { LlmLogData, LogEntry, LogKind, StatusResponse } from "@/lib/types";

import type { PlayState } from "./CameraDashboard";

const POLL_MS = 1_500;
const MAX_ENTRIES = 200;
// The AI log shows Nemotron's answers and what came of them, not server housekeeping.
const KINDS: LogKind[] = ["frame", "possible_fall", "fall_confirmed", "fall_cancelled", "recovered", "workflow", "alert", "error"];

type Status = "normal" | "watch" | "emergency" | "error" | "info";
type Filter = "all" | "falls";

interface View {
  status: Status;
  tag: string;
  event: string | null;
  summary: string;
  meta: string | null;
  raw: string | null;
  fall: boolean;
}

interface Props {
  current: Camera;
  currentHasVideo: boolean;
  playState: PlayState;
  lastLatencyMs: number | null;
  model: StatusResponse["model"] | null;
  error: string | null;
  onSelectCamera: (camId: string) => void;
}

/** What the local AI says about the cameras: every Nemotron answer (fall or no fall) and the events it led to. */
export default function AiLog({ current, currentHasVideo, playState, lastLatencyMs, model, error, onSelectCamera }: Props) {
  const { panel: panelRef, handle: headRef } = useDraggable<HTMLElement, HTMLElement>("sentry.aiLog.position");
  const [minimised, setMinimised] = useMinimised("sentry.aiLog.minimised", "(max-width: 640px)");
  const [pillStyle, setPillStyle] = useState<CSSProperties>({});
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const lastId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const limit = lastId.current === 0 ? 100 : 500;
        const res = await fetch(`/api/logs?after=${lastId.current}&limit=${limit}&kinds=${KINDS.join(",")}`, { cache: "no-store" });
        if (res.ok) {
          const { entries: fresh } = (await res.json()) as { entries: LogEntry[] };
          if (!cancelled && fresh.length > 0) {
            lastId.current = fresh[0].id;
            setEntries((old) => [...fresh, ...old].slice(0, MAX_ENTRIES));
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

  const minimise = () => {
    // A panel that was dragged leaves its pill where the panel was.
    const p = panelRef.current;
    setPillStyle(p?.style.left ? { left: p.style.left, top: p.style.top } : {});
    setMinimised(true);
  };

  const views = entries.map((e) => ({ entry: e, view: toView(e) }));
  const visible = filter === "falls" ? views.filter(({ view }) => view.fall || view.status === "emergency" || view.status === "watch") : views;
  const lastLlm = views.find(({ entry }) => entry.kind === "frame");
  const dotStatus = lastLlm?.view.status ?? "info";

  const offline = model !== null && (!model.reachable || model.error);
  const speed = lastLatencyMs ? ` · ${(lastLatencyMs / 1000).toFixed(1)} s per frame` : "";
  const statusText = offline
    ? "Nemotron offline"
    : !currentHasVideo
      ? `Waiting for video on ${current.code}`
      : playState === "ready"
        ? `${current.code} ready · press Space to play`
        : playState === "ended"
          ? `Watching the last frame of ${current.code}${speed}`
          : `Watching ${cameraLabel(current)}${speed}`;

  return (
    <>
      <aside className="ailog" ref={panelRef} aria-label="AI log" hidden={minimised}>
        <header className="ailog-head" ref={headRef}>
          <div>
            <h2>AI log</h2>
            <p className="ailog-status" aria-live="polite">
              {statusText}
            </p>
          </div>
          <button className="panel-min" type="button" aria-label="Minimise AI log" title="Minimise" onClick={minimise}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        {offline && (
          <p className="ailog-note">
            Nemotron isn&apos;t answering at {model.baseUrl}
            {model.error ? `: ${model.error}` : ""}. Check the SSH tunnel or LLM_BASE_URL.
          </p>
        )}
        {!offline && error && <p className="ailog-note">{error}</p>}
        <div className="ailog-filter" role="group" aria-label="Show">
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All
          </button>
          <button type="button" aria-pressed={filter === "falls"} onClick={() => setFilter("falls")}>
            Falls only
          </button>
        </div>
        <ol className="ailog-list">
          {visible.length === 0 && (
            <li className="log-empty">
              {filter === "falls" ? "No falls so far." : "Nemotron describes the camera on screen frame by frame. Its first answer is on the way."}
            </li>
          )}
          {visible.map(({ entry, view }) => {
            const cam = entry.camera ? CAMERA_BY_ID.get(entry.camera) : undefined;
            return (
              <li
                key={entry.id}
                className="log-entry"
                data-status={view.status}
                onClick={() => cam && onSelectCamera(cam.id)}
              >
                <div className="le-head">
                  <time>{clock(new Date(entry.ts))}</time>
                  <span className="le-cam">{cam ? cameraLabel(cam) : entry.source ?? ""}</span>
                  <span className="le-tag">{view.tag}</span>
                </div>
                {view.event && <strong className="le-event">{view.event}</strong>}
                <p>{view.summary}</p>
                {view.meta && <div className="le-meta">{view.meta}</div>}
                {view.raw && (
                  <details className="le-raw" onClick={(e) => e.stopPropagation()}>
                    <summary>LLM output</summary>
                    <pre>{view.raw}</pre>
                  </details>
                )}
                {entry.snapshot && (
                  // eslint-disable-next-line @next/next/no-img-element -- local snapshot served by our own API
                  <img src={entry.snapshot} alt="Frame where the fall was confirmed" style={{ display: "block", width: "100%", marginTop: 6, borderRadius: 4 }} />
                )}
              </li>
            );
          })}
        </ol>
      </aside>
      <button className="ailog-pill" type="button" hidden={!minimised} style={pillStyle} onClick={() => setMinimised(false)}>
        <span className="ailog-dot" data-status={dotStatus} />
        AI log
      </button>
    </>
  );
}

function toView(e: LogEntry): View {
  if (e.kind === "frame") {
    const d = e.data as Partial<LlmLogData> | null;
    const fall = d?.fall === true;
    const meta = [
      typeof d?.latencyMs === "number" && `${(d.latencyMs / 1000).toFixed(1)} s on the local AI`,
      typeof d?.confidence === "number" && `${Math.round(d.confidence * 100)}% sure`,
      d?.model,
    ].filter(Boolean);
    return {
      status: fall ? "emergency" : "normal",
      tag: fall ? "Fall" : "No fall",
      event: null,
      summary: d?.verdict?.description || e.message.replace(/^(FALL|No fall) · /, ""),
      meta: meta.length ? meta.join(" · ") : null,
      raw: typeof d?.output === "string" ? prettyJson(d.output) : null,
      fall,
    };
  }
  const base = { event: null, meta: null, raw: null, fall: false, summary: e.message };
  switch (e.kind) {
    case "possible_fall":
      return { ...base, status: "watch", tag: "Possible fall" };
    case "fall_confirmed":
      return e.level === "critical"
        ? { ...base, status: "emergency", tag: "Emergency", event: "Fall confirmed", fall: true }
        : { ...base, status: "watch", tag: "Still down" };
    case "fall_cancelled":
      return { ...base, status: "normal", tag: "False alarm" };
    case "recovered":
      return { ...base, status: "normal", tag: "Recovered" };
    case "error":
      return { ...base, status: "error", tag: "Problem" };
    case "workflow":
      return { ...base, status: "info", tag: "Workflow" };
    default:
      return { ...base, status: "info", tag: "Info" };
  }
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
