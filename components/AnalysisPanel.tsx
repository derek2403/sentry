import type { FallState, FrameVerdict } from "@/lib/types";

interface Props {
  verdict: FrameVerdict | null;
  fallState: FallState;
  frames: number;
  latencyMs: number;
  analysing: boolean;
}

const STEPS: { state: FallState; label: string; hint: string }[] = [
  { state: "monitoring", label: "Monitoring", hint: "Watching every sampled frame" },
  { state: "candidate", label: "Possible fall", hint: "A frame shows someone down; checking the next frames" },
  { state: "confirmed", label: "Fall confirmed", hint: "Still down; emergency workflow triggered" },
];

export default function AnalysisPanel({ verdict, fallState, frames, latencyMs, analysing }: Props) {
  const current = STEPS.findIndex((s) => s.state === fallState);

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Nemotron analysis</h2>
        <span className="font-mono text-xs text-muted">{analysing ? "running" : "idle"}</span>
      </div>

      <ol className="flex flex-col gap-3">
        {STEPS.map((step, i) => {
          const active = i === current;
          const colour = step.state === "confirmed" ? "bg-danger" : step.state === "candidate" ? "bg-warn" : "bg-ok";
          return (
            <li key={step.state} className={`flex gap-3 ${active ? "" : "opacity-45"}`}>
              <span className={`mt-1 size-3 shrink-0 rounded-full ${active ? colour : "border border-muted"}`} />
              <div>
                <p className="text-sm font-medium">{step.label}</p>
                <p className="text-xs text-muted">{step.hint}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="rounded-xl border border-line bg-panel-2 p-3">
        <p className="mb-3 text-xs tracking-wide text-muted uppercase">Latest frame</p>
        {verdict ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Person" value={verdict.person_visible ? "In view" : "Not visible"} />
            <Field label="Posture" value={verdict.posture} />
            <Field label="On the floor" value={verdict.on_floor ? "Yes" : "No"} warn={verdict.on_floor} />
            <Field label="Fall" value={verdict.fall_detected ? "Detected" : "No"} warn={verdict.fall_detected} />
            <div className="col-span-2">
              <dt className="text-xs text-muted">Confidence</dt>
              <dd className="mt-1 flex items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <span
                    className={`block h-full rounded-full ${verdict.fall_detected ? "bg-danger" : "bg-accent"}`}
                    style={{ width: `${Math.round(verdict.confidence * 100)}%` }}
                  />
                </span>
                <span className="font-mono text-xs">{Math.round(verdict.confidence * 100)}%</span>
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted">Description</dt>
              <dd className="mt-0.5">{verdict.description || "—"}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted">Upload a video to see Nemotron&apos;s verdict for each frame.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-center">
        <Stat label="Frames analysed" value={String(frames)} />
        <Stat label="Last latency" value={latencyMs ? `${latencyMs} ms` : "—"} />
      </div>
    </div>
  );
}

function Field({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`capitalize ${warn ? "font-medium text-warn" : ""}`}>{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2 px-3 py-2">
      <p className="font-mono text-lg">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
