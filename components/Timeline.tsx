import type { FallState, FrameVerdict } from "@/lib/types";

export interface TimelinePoint {
  t: number;
  verdict: FrameVerdict | null;
  state: FallState;
}

function colour(p: TimelinePoint): string {
  if (!p.verdict) return "bg-muted/40";
  if (p.state === "confirmed") return "bg-danger";
  if (p.verdict.fall_detected) return "bg-warn";
  if (!p.verdict.person_visible) return "bg-line";
  return "bg-ok";
}

function label(p: TimelinePoint): string {
  if (!p.verdict) return `${p.t.toFixed(1)}s · analysis failed`;
  const v = p.verdict;
  return `${p.t.toFixed(1)}s · ${v.person_visible ? v.posture : "no person"}${v.fall_detected ? " · fall" : ""} · ${Math.round(v.confidence * 100)}%`;
}

/** One bar per analysed frame, so you can see Nemotron working frame by frame. */
export default function Timeline({ points }: { points: TimelinePoint[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-muted">
        <span>Frame-by-frame analysis</span>
        <span className="flex items-center gap-3">
          <Legend className="bg-ok" text="OK" />
          <Legend className="bg-warn" text="Down" />
          <Legend className="bg-danger" text="Fall confirmed" />
          <Legend className="bg-line" text="No person" />
        </span>
      </div>
      <div className="flex h-10 items-end gap-[3px] overflow-hidden rounded-lg border border-line bg-panel-2 p-1.5">
        {points.length === 0 ? (
          <span className="self-center px-1 text-xs text-muted">No frames analysed yet</span>
        ) : (
          points.map((p, i) => <span key={`${p.t}-${i}`} title={label(p)} className={`h-full w-2 shrink-0 rounded-sm ${colour(p)}`} />)
        )}
      </div>
    </div>
  );
}

function Legend({ className, text }: { className: string; text: string }) {
  return (
    <span className="hidden items-center gap-1 sm:inline-flex">
      <span className={`size-2 rounded-sm ${className}`} />
      {text}
    </span>
  );
}
