import { sentry } from "@/lib/server/sentry";
import type { LogKind } from "@/lib/types";

/** Backlog entries, newest first. Query: ?after=<id>&limit=<n>&kinds=frame,fall_confirmed */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const afterId = Math.max(0, Number(params.get("after")) || 0);
  const limit = Math.min(Math.max(Number(params.get("limit")) || 200, 1), 1000);
  const kinds = params.get("kinds")?.split(",").filter(Boolean) as LogKind[] | undefined;
  return Response.json({ entries: sentry().log.list({ afterId, limit, kinds }) });
}
