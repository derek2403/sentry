import type { Alert } from "@/lib/types";

import { AlertIcon } from "./icons";

export default function AlertCard({ alert, onAcknowledge }: { alert: Alert; onAcknowledge: () => void }) {
  return (
    <div className="alert-pulse flex flex-col gap-3 rounded-2xl border border-danger bg-danger/10 p-4" role="alert">
      <div className="flex items-center gap-2 text-danger">
        <AlertIcon className="size-5" />
        <h2 className="font-semibold">Fall detected</h2>
        <span className="ml-auto font-mono text-xs">{new Date(alert.ts).toLocaleTimeString()}</span>
      </div>
      {alert.snapshot && (
        // eslint-disable-next-line @next/next/no-img-element -- local snapshot served by our own API
        <img src={alert.snapshot} alt="Frame where the fall was confirmed" className="w-full rounded-lg border border-danger/40" />
      )}
      <p className="text-sm">{alert.message}</p>
      <p className="text-xs text-muted">Emergency workflow triggered. Check the Backlog for each step.</p>
      <button
        type="button"
        onClick={onAcknowledge}
        className="rounded-lg bg-danger px-3 py-2 text-sm font-semibold text-white hover:brightness-110"
      >
        Acknowledge
      </button>
    </div>
  );
}
