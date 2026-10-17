import { sentry } from "@/lib/server/sentry";

export async function POST() {
  return Response.json({ acknowledged: sentry().acknowledgeAlert() });
}
