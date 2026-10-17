import { HttpError, sentry } from "@/lib/server/sentry";

const MAX_IMAGE_CHARS = 8_000_000; // ~6 MB JPEG as base64

/** Analyse one frame with Nemotron. Body: { image: "data:image/jpeg;base64,...", t: seconds } */
export async function POST(request: Request, ctx: RouteContext<"/api/sessions/[id]/frames">) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { image?: unknown; t?: unknown } | null;
  const image = body?.image;
  const t = Number(body?.t);

  if (typeof image !== "string" || !image.startsWith("data:image/jpeg;base64,")) {
    return Response.json({ error: "image must be a JPEG data URL" }, { status: 400 });
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return Response.json({ error: "image is too large" }, { status: 413 });
  }
  if (!Number.isFinite(t) || t < 0) {
    return Response.json({ error: "t must be a non-negative number of seconds" }, { status: 400 });
  }

  try {
    return Response.json(await sentry().analyse(id, image, t));
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
