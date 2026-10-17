// Parses Nemotron's reply into a FrameVerdict. Kept free of server-only imports so it can be unit-tested.

import type { FrameVerdict, Posture } from "../types";

const POSTURES: Posture[] = ["standing", "walking", "sitting", "bending", "lying", "unknown"];

export function parseVerdict(content: string): FrameVerdict {
  // Reasoning models may wrap their thinking in <think> tags before the answer.
  const text = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "") // thinking that was cut off
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(`Nemotron did not return JSON: ${text.slice(0, 120)}`);

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error(`Nemotron returned invalid JSON: ${text.slice(start, start + 120)}`);
  }

  const posture = String(raw.posture ?? "unknown").toLowerCase() as Posture;
  const confidence = Number(raw.confidence);
  return {
    person_visible: toBool(raw.person_visible),
    posture: POSTURES.includes(posture) ? posture : "unknown",
    on_floor: toBool(raw.on_floor),
    fall_detected: toBool(raw.fall_detected),
    confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0,
    description: String(raw.description ?? "").trim().slice(0, 200),
  };
}

/** A one-line summary of an LLM reply for the Backlog: its "description" if it is JSON, else the text itself. */
export function summariseOutput(output: string, maxLength = 160): string {
  let text = output.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").trim();
  try {
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { description?: unknown };
    if (typeof parsed.description === "string" && parsed.description.trim()) text = parsed.description.trim();
  } catch {
    // Not JSON: use the text as is.
  }
  text = text.replace(/\s+/g, " ");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text || "(empty reply)";
}

function toBool(value: unknown): boolean {
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return value === true;
}
