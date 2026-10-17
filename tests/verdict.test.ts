import { describe, expect, it } from "vitest";

import { parseVerdict, summariseOutput } from "../lib/server/verdict";

describe("summariseOutput", () => {
  it("uses the description of a JSON reply", () => {
    expect(summariseOutput('{"emergency":true,"description":"Man lying on the floor."}')).toBe("Man lying on the floor.");
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
    const v = parseVerdict(
      '{"emergency":true,"type":"fire_smoke","person_visible":false,"posture":"unknown","on_floor":false,"confidence":0.87,"description":"Smoke rising from the stove."}',
    );
    expect(v).toEqual({
      emergency: true,
      type: "fire_smoke",
      person_visible: false,
      posture: "unknown",
      on_floor: false,
      confidence: 0.87,
      description: "Smoke rising from the stove.",
    });
  });

  it("strips reasoning and surrounding text", () => {
    const v = parseVerdict('<think>The person is fine...</think>\nHere you go:\n```json\n{"emergency": false, "type": "none", "person_visible": true, "posture": "standing", "on_floor": false, "confidence": 0.9, "description": "Standing."}\n```');
    expect(v.posture).toBe("standing");
    expect(v.emergency).toBe(false);
  });

  it("keeps emergency and type consistent", () => {
    expect(parseVerdict('{"emergency":false,"type":"fall","confidence":0.9}').type).toBe("none");
    expect(parseVerdict('{"emergency":true,"type":"none","confidence":0.9}').type).toBe("other");
    expect(parseVerdict('{"emergency":true,"type":"earthquake","confidence":0.9}').type).toBe("other");
  });

  it("accepts the older fall-only format", () => {
    expect(parseVerdict('{"fall_detected":true,"confidence":0.9}')).toMatchObject({ emergency: true, type: "fall" });
    expect(parseVerdict('{"fall_detected":false,"confidence":0.9}')).toMatchObject({ emergency: false, type: "none" });
  });

  it("normalises odd values instead of trusting them", () => {
    const v = parseVerdict('{"emergency":"true","type":"FALL","person_visible":"true","posture":"Crawling","confidence":7}');
    expect(v).toMatchObject({ emergency: true, type: "fall", person_visible: true, posture: "unknown", on_floor: false, confidence: 1, description: "" });
  });

  it("ignores an unfinished <think> block", () => {
    expect(() => parseVerdict("<think>Let me look at {the person}...")).toThrow(/did not return JSON/);
  });

  it("throws on a reply with no JSON", () => {
    expect(() => parseVerdict("I cannot see the image.")).toThrow(/did not return JSON/);
  });
});
