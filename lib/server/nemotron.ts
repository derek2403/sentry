import "server-only";

import { EMERGENCY_TYPES } from "../emergency";
import type { FrameVerdict, Posture } from "../types";
import { config } from "./config";
import { parseVerdict } from "./verdict";

const SYSTEM_PROMPT = `You are Sentry, a home-safety system watching CCTV frames from a family home with elderly residents, children and pets.
For each frame, decide whether anything in it is an emergency that needs someone to help right now, and describe what you see.

Reply with ONLY a JSON object, no other text:
{"emergency": boolean, "type": "none"|"fall"|"fire_smoke"|"water_leak"|"medical"|"child_danger"|"intruder"|"other", "person_visible": boolean, "posture": "standing"|"walking"|"sitting"|"bending"|"lying"|"unknown", "on_floor": boolean, "confidence": number between 0 and 1, "description": "one short sentence, max 20 words"}

Emergency types:
- fall: a person on the floor in a way that suggests they fell or collapsed (lying, sprawled or slumped on the floor), or visibly in the middle of falling.
- fire_smoke: flames or smoke anywhere they should not be, or a fire spreading beyond a stove burner, candle or fireplace.
- water_leak: flooding, a burst pipe, water spreading across the floor, or an overflowing sink or bath.
- medical: a person in visible distress without a fall: clutching their chest, having a seizure, choking, bleeding, or unresponsive in a chair.
- child_danger: a child at a hazard: climbing a window, balcony or railing, alone near a hot stove or a pool, or holding a knife, medicine or chemicals.
- intruder: someone breaking in, forcing a door or window, or a person being attacked.
- other: anything else that clearly needs urgent help.

Not emergencies: sleeping in bed, lying on a sofa or exercise mat on purpose, sitting on a chair or the floor calmly, normal cooking, a lit candle or fireplace, children playing safely, pets.

Rules:
- emergency is true only for one of the types above; then type is that type. Otherwise emergency=false and type="none".
- If several apply, pick the most urgent.
- person_visible, posture and on_floor describe the main person; if nobody is visible: person_visible=false, posture="unknown", on_floor=false.
- on_floor is true if the person's body (not just their feet) is on the floor.
- confidence is how sure you are about your emergency answer, whether it is true or false.`;

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    emergency: { type: "boolean" },
    type: { type: "string", enum: EMERGENCY_TYPES },
    person_visible: { type: "boolean" },
    posture: { type: "string", enum: ["standing", "walking", "sitting", "bending", "lying", "unknown"] satisfies Posture[] },
    on_floor: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    description: { type: "string" },
  },
  required: ["emergency", "type", "person_visible", "posture", "on_floor", "confidence", "description"],
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
    ? `Previous frame: ${previous.emergency ? `emergency (${previous.type})` : "no emergency"}. ${previous.description}`
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
