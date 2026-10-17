import { connection } from "next/server";

import { config } from "@/lib/server/config";
import { checkHealth, currentModelId } from "@/lib/server/nemotron";
import { sentry } from "@/lib/server/sentry";
import type { StatusResponse } from "@/lib/types";

export async function GET() {
  await connection();
  const health = await checkHealth();
  const app = sentry();
  const body: StatusResponse = {
    alert: app.currentAlert(),
    model: { id: currentModelId(), baseUrl: config.llm.baseUrl, reachable: health.reachable, error: health.error },
    analysis: config.analysis,
    cameraName: config.cameraName,
    activeSessions: app.activeSessions(),
  };
  return Response.json(body);
}
