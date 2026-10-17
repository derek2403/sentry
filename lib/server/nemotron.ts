import "server-only";

import type { FrameVerdict, Posture } from "../types";
import { config } from "./config";
import { parseVerdict } from "./verdict";

const SYSTEM_PROMPT = `You are Sentry, a home-safety system watching CCTV frames from a family home, with a focus on elderly residents.
For each frame, describe the main person and decide whether they have fallen.

Reply with ONLY a JSON object, no other text:
{"person_visible": boolean, "posture": "standing"|"walking"|"sitting"|"bending"|"lying"|"unknown", "on_floor": boolean, "fall_detected": boolean, "confidence": number between 0 and 1, "description": "one short sentence, max 20 words"}

Rules:
- fall_detected is true if a person is on the floor in a way that suggests they fell or collapsed (lying, sprawled or slumped on the floor rather than on a bed, sofa or chair), or is visibly in the middle of falling.
- Lying on a bed, sofa or exercise mat on purpose is NOT a fall. Sitting on a chair is NOT a fall.
- on_floor is true if the person's body (not just their feet) is on the floor.
- If no person is visible: person_visible=false, posture="unknown", on_floor=false, fall_detected=false.
- confidence is how sure you are about fall_detected.`;

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    person_visible: { type: "boolean" },
    posture: { type: "string", enum: ["standing", "walking", "sitting", "bending", "lying", "unknown"] satisfies Posture[] },
    on_floor: { type: "boolean" },
    fall_detected: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    description: { type: "string" },
  },
  required: ["person_visible", "posture", "on_floor", "fall_detected", "confidence", "description"],
  additionalProperties: false,
};

let resolvedModel: string | null = config.llm.model || null;
// Set to false if the endpoint rejects guided JSON, so we stop sending it.
let jsonSchemaSupported = config.llm.jsonSchema;

function headers(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (config.llm.apiKey) h.Authorization = `Bearer ${config.llm.apiKey}`;
  return h;
}

/** Lists the models served by the local endpoint. Throws if it is unreachable. */
export async function listModels(timeoutMs = 5_000): Promise<string[]> {
  const res = await fetch(`${config.llm.baseUrl}/models`, { headers: headers(), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET /models returned ${res.status}`);
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => m.id);
}

export async function getModelId(): Promise<string> {
  if (resolvedModel) return resolvedModel;
  const models = await listModels();
  if (models.length === 0) throw new Error("the inference endpoint serves no models");
  resolvedModel = models[0];
  return resolvedModel;
}

export function currentModelId(): string | null {
  return resolvedModel;
}

let health: { checkedAt: number; reachable: boolean; error: string | null } = { checkedAt: 0, reachable: false, error: null };

/** Whether the local endpoint is up, checked at most every 10 s. */
export async function checkHealth(): Promise<{ reachable: boolean; error: string | null }> {
  if (Date.now() - health.checkedAt < 10_000) return health;
  try {
    const models = await listModels(3_000);
    if (!resolvedModel && models.length > 0) resolvedModel = models[0];
    const error = config.llm.model && !models.includes(config.llm.model)
      ? `LLM_MODEL "${config.llm.model}" is not served here (available: ${models.join(", ") || "none"})`
      : null;
    health = { checkedAt: Date.now(), reachable: true, error };
  } catch (err) {
    health = { checkedAt: Date.now(), reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
  return health;
}

export interface AnalyseInput {
  imageDataUrl: string; // data:image/jpeg;base64,...
  t: number;
  source: string;
  previous: FrameVerdict | null;
}

export interface AnalyseResult {
  verdict: FrameVerdict;
  output: string; // the model's reply, exactly as returned
  model: string;
}

/** Sends one frame to Nemotron and returns its verdict along with the raw reply. */
export async function analyseFrame({ imageDataUrl, t, source, previous }: AnalyseInput): Promise<AnalyseResult> {
  const model = await getModelId();
  const context = previous
    ? `Previous frame: ${previous.posture}${previous.on_floor ? " on the floor" : ""}. ${previous.description}`
    : "This is the first frame.";

  const body: Record<string, unknown> = {
    model,
    temperature: 0,
    max_tokens: config.llm.maxTokens,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `Camera "${source}", ${t.toFixed(1)}s. ${context}\nAnalyse this frame.` },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  };
  if (config.llm.disableThinking) body.chat_template_kwargs = { enable_thinking: false };

  let res = await post(body, jsonSchemaSupported);
  if (res.status === 400 && jsonSchemaSupported) {
    const text = await res.text().catch(() => "");
    // Only give up on guided decoding if that is what the endpoint rejected.
    if (!/response_format|json_schema|guided|structured/i.test(text)) {
      throw new Error(`Nemotron request failed (400): ${text.slice(0, 200)}`);
    }
    console.warn("[sentry] endpoint rejected guided JSON; continuing with prompt-only JSON");
    jsonSchemaSupported = false;
    res = await post(body, false);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Nemotron request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const reply = (await res.json()) as {
    choices?: { finish_reason?: string; message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null } }[];
  };
  const choice = reply.choices?.[0];
  const message = choice?.message;
  // Reasoning models served with a reasoning parser may put text in reasoning_content.
  const content = message?.content || message?.reasoning_content || message?.reasoning || "";
  if (!message?.content && choice?.finish_reason === "length") {
    throw new Error("model hit LLM_MAX_TOKENS before answering (is thinking still on?)");
  }
  return { verdict: parseVerdict(content), output: content, model };
}

function post(body: Record<string, unknown>, withSchema: boolean): Promise<Response> {
  const payload = withSchema
    ? { ...body, response_format: { type: "json_schema", json_schema: { name: "frame_verdict", schema: VERDICT_SCHEMA } } }
    : body;
  return fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.llm.timeoutMs),
  });
}
