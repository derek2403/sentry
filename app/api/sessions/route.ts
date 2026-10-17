import { sentry } from "@/lib/server/sentry";
import type { SourceKind } from "@/lib/types";

/** Start analysing a camera feed. Body: { source: "upload" | "camera", name: string, camera?: string } */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { source?: SourceKind; name?: string; camera?: unknown } | null;
  if (!body || (body.source !== "upload" && body.source !== "camera")) {
    return Response.json({ error: 'source must be "upload" or "camera"' }, { status: 400 });
  }
  const name = String(body.name ?? "").trim().slice(0, 120) || "Camera";
  const camera = typeof body.camera === "string" && /^[\w-]{1,40}$/.test(body.camera) ? body.camera : null;
  return Response.json(sentry().startSession(body.source, name, camera), { status: 201 });
}
