import { describe, expect, it } from "vitest";

import { parseVerdict, summariseOutput } from "../lib/server/verdict";

describe("summariseOutput", () => {
  it("uses the description of a JSON reply", () => {
    expect(summariseOutput('{"fall_detected":true,"description":"Man lying on the floor."}')).toBe("Man lying on the floor.");
  });

  it("falls back to the plain text, trimmed and shortened", () => {
    expect(summariseOutput("  The person\n is   sitting.  ")).toBe("The person is sitting.");
    expect(summariseOutput("x".repeat(300))).toHaveLength(160);
  });

  it("drops reasoning blocks", () => {
    expect(summariseOutput("<think>hmm</think> All clear.")).toBe("All clear.");
  });
});

describe("parseVerdict", () => {
  it("parses a plain JSON reply", () => {
    const v = parseVerdict('{"person_visible":true,"posture":"lying","on_floor":true,"fall_detected":true,"confidence":0.87,"description":"Fell by the sofa."}');
    expect(v).toEqual({ person_visible: true, posture: "lying", on_floor: true, fall_detected: true, confidence: 0.87, description: "Fell by the sofa." });
  });

  it("strips reasoning and surrounding text", () => {
    const v = parseVerdict('<think>The person is on the floor...</think>\nHere you go:\n```json\n{"person_visible": true, "posture": "standing", "on_floor": false, "fall_detected": false, "confidence": 0.9, "description": "Standing."}\n```');
    expect(v.posture).toBe("standing");
    expect(v.fall_detected).toBe(false);
  });

  it("normalises odd values instead of trusting them", () => {
    const v = parseVerdict('{"person_visible":"true","posture":"Crawling","fall_detected":"false","confidence":7}');
    expect(v).toMatchObject({ person_visible: true, posture: "unknown", on_floor: false, fall_detected: false, confidence: 1, description: "" });
  });

  it("ignores an unfinished <think> block", () => {
    expect(() => parseVerdict('<think>Let me look at {the person}...')).toThrow(/did not return JSON/);
  });

  it("throws on a reply with no JSON", () => {
    expect(() => parseVerdict("I cannot see the image.")).toThrow(/did not return JSON/);
  });
});
