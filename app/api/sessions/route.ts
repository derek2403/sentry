import { sentry } from "@/lib/server/sentry";
import type { SourceKind } from "@/lib/types";

/** Start analysing a new video or camera feed. Body: { source: "upload" | "camera", name: string } */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { source?: SourceKind; name?: string } | null;
  if (!body || (body.source !== "upload" && body.source !== "camera")) {
    return Response.json({ error: 'source must be "upload" or "camera"' }, { status: 400 });
  }
  const name = String(body.name ?? "").trim().slice(0, 120) || (body.source === "upload" ? "video" : "camera");
  return Response.json(sentry().startSession(body.source, name), { status: 201 });
}
