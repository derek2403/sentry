import { EMERGENCY_TYPES } from "@/lib/emergency";
import { sentry } from "@/lib/server/sentry";
import type { EmergencyType, LogKind } from "@/lib/types";

const MAX_OUTPUT_CHARS = 8_000;

/** Backlog entries, newest first. Query: ?after=<id>&limit=<n>&kinds=frame,fall_confirmed */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const afterId = Math.max(0, Number(params.get("after")) || 0);
  const limit = Math.min(Math.max(Number(params.get("limit")) || 200, 1), 1000);
  const kinds = params.get("kinds")?.split(",").filter(Boolean) as LogKind[] | undefined;
  return Response.json({ entries: sentry().log.list({ afterId, limit, kinds }) });
}

/**
 * Log one LLM answer to the AI log, for LLM output produced outside the frame analyser.
 * Body: { output: string, emergency: boolean, type?: "fall" | "fire_smoke" | ..., source?: string,
 *         camera?: string, t?: number, confidence?: number, model?: string }
 * The older `fall: boolean` is still accepted in place of `emergency`.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const emergency = typeof body?.emergency === "boolean" ? body.emergency : typeof body?.fall === "boolean" ? body.fall : null;
  if (!body || typeof body.output !== "string" || emergency === null) {
    return Response.json({ error: 'body must include "output" (string) and "emergency" (boolean)' }, { status: 400 });
  }
  const type = typeof body.type === "string" && EMERGENCY_TYPES.includes(body.type as EmergencyType)
    ? (body.type as EmergencyType)
    : body.fall === true ? "fall" : undefined;
  const optionalNumber = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const optionalString = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

  const entry = sentry().logLlmOutput({
    output: body.output.slice(0, MAX_OUTPUT_CHARS),
    emergency,
    type,
    source: optionalString(body.source, 120),
    camera: optionalString(body.camera, 40),
    t: optionalNumber(body.t),
    confidence: optionalNumber(body.confidence),
    model: optionalString(body.model, 120),
  });
  return Response.json(entry, { status: 201 });
}
