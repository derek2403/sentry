import { sentry } from "@/lib/server/sentry";

/** End a session. Optional query: ?reason=ended|stopped */
export async function DELETE(request: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const { id } = await ctx.params;
  const reason = new URL(request.url).searchParams.get("reason")?.slice(0, 40) || "stopped";
  sentry().endSession(id, reason);
  return new Response(null, { status: 204 });
}
