import fs from "node:fs/promises";
import path from "node:path";

import { sentry } from "@/lib/server/sentry";

/** Serves a locally stored alert snapshot. These never leave the ATOM except to the dashboard. */
export async function GET(_request: Request, ctx: RouteContext<"/api/snapshots/[name]">) {
  const { name } = await ctx.params;
  if (!/^[0-9a-f-]{36}\.jpg$/.test(name)) return new Response("Not found", { status: 404 });
  try {
    const file = await fs.readFile(path.join(sentry().snapshotDir, name));
    return new Response(file, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
