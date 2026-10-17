import { describe, expect, it } from "vitest";

import { DEFAULT_FALL_CONFIG, FallDetector } from "../lib/server/fall";
import type { FallEvent, FrameVerdict } from "../lib/types";

const v = (overrides: Partial<FrameVerdict>): FrameVerdict => ({
  emergency: false,
  type: "none",
  person_visible: true,
  posture: "standing",
  on_floor: false,
  confidence: 0.9,
  description: "",
  ...overrides,
});

const standing = v({ description: "standing" });
const fallen = v({ emergency: true, type: "fall", posture: "lying", on_floor: true, description: "on the floor" });
const onSofa = v({ posture: "lying", description: "lying on the sofa" });
const sitting = v({ posture: "sitting", confidence: 0.8, description: "sitting" });
const nobody = v({ person_visible: false, posture: "unknown", description: "empty room" });
const fire = v({ emergency: true, type: "fire_smoke", person_visible: false, posture: "unknown", description: "flames on the stove" });

/** Feeds verdicts at 2 frames per second and returns every event. */
function run(verdicts: FrameVerdict[], detector = new FallDetector(DEFAULT_FALL_CONFIG)): FallEvent[] {
  return verdicts.flatMap((verdict, i) => detector.update(verdict, i * 0.5).events);
}

const repeat = (verdict: FrameVerdict, n: number) => Array<FrameVerdict>(n).fill(verdict);
const kinds = (events: FallEvent[]) => events.map((e) => e.kind);

describe("FallDetector (any emergency)", () => {
  it("confirms a fall once it lasts 2 s over several frames", () => {
    const events = run([...repeat(standing, 4), ...repeat(fallen, 6)]);
    expect(kinds(events)).toEqual(["possible_fall", "fall_confirmed"]);
    expect(events[0].t).toBe(2);
    expect(events[1].t).toBe(4); // 2 s after the first emergency frame
    expect(events[1].type).toBe("fall");
  });

  it("confirms other emergencies the same way, with their type", () => {
    const events = run([...repeat(nobody, 2), ...repeat(fire, 6)]);
    expect(kinds(events)).toEqual(["possible_fall", "fall_confirmed"]);
    expect(events[1].type).toBe("fire_smoke");
  });

  it("does not confirm on a single bad frame", () => {
    expect(kinds(run([...repeat(standing, 4), fallen, ...repeat(standing, 4)]))).toEqual(["possible_fall", "fall_cancelled"]);
  });

  it("ignores someone lying on a sofa (the model says no emergency)", () => {
    expect(run([...repeat(standing, 2), ...repeat(onSofa, 10)])).toEqual([]);
  });

  it("trusts the model when someone on the floor is fine", () => {
    const onRug = v({ posture: "lying", on_floor: true, confidence: 0.95, description: "lying on the rug on purpose" });
    expect(run([...repeat(standing, 2), ...repeat(onRug, 10)])).toEqual([]);
  });

  it("does not confirm from two isolated emergency frames with clear frames between", () => {
    expect(kinds(run([standing, fallen, ...repeat(sitting, 8), fallen, ...repeat(sitting, 8)]))).not.toContain("fall_confirmed");
  });

  it("restarts the confirmation window after a clear frame", () => {
    // fall at 0.5, clear at 1.0, then fall from 1.5: confirmation needs 2 s from 1.5, i.e. at 3.5.
    const events = run([standing, fallen, sitting, ...repeat(fallen, 6)]);
    expect(kinds(events)).toEqual(["possible_fall", "fall_confirmed"]);
    expect(events[1].t).toBe(3.5);
  });

  it("ignores low-confidence emergency verdicts", () => {
    expect(run(repeat({ ...fallen, confidence: 0.3 }, 10))).toEqual([]);
  });

  it("keeps waiting while a fallen person is briefly out of view", () => {
    expect(kinds(run([standing, fallen, nobody, nobody, fallen, fallen]))).toEqual(["possible_fall", "fall_confirmed"]);
  });

  it("treats an empty, normal room as clear for a fire", () => {
    expect(kinds(run([fire, nobody, nobody, nobody]))).toEqual(["possible_fall", "fall_cancelled"]);
  });

  it("cancels a candidate when no emergency is seen for longer than the timeout", () => {
    const blurry = v({ confidence: 0.2, description: "hard to tell" });
    expect(kinds(run([standing, fallen, ...repeat(blurry, 25)]))).toEqual(["possible_fall", "fall_cancelled"]);
  });

  it("reports recovery once the scene is clear again", () => {
    expect(kinds(run([...repeat(fallen, 6), ...repeat(standing, 3)]))).toEqual(["possible_fall", "fall_confirmed", "recovered"]);
  });

  it("counts someone standing as clear even when the model says on_floor", () => {
    // Nemotron Omni answers on_floor=true for "standing upright on the floor".
    const standingOnFloor = v({ on_floor: true, description: "standing" });
    expect(kinds(run([...repeat(fallen, 6), ...repeat(standingOnFloor, 3)]))).toEqual(["possible_fall", "fall_confirmed", "recovered"]);
  });

  it("needs several clear frames to recover, not one", () => {
    expect(kinds(run([...repeat(fallen, 6), standing, fallen, standing]))).toEqual(["possible_fall", "fall_confirmed"]);
  });
});
