import { describe, expect, it } from "vitest";

import { DEFAULT_FALL_CONFIG, FallDetector } from "../lib/server/fall";
import type { FallEvent, FrameVerdict } from "../lib/types";

const standing: FrameVerdict = { person_visible: true, posture: "standing", on_floor: false, fall_detected: false, confidence: 0.9, description: "standing" };
const fallen: FrameVerdict = { person_visible: true, posture: "lying", on_floor: true, fall_detected: true, confidence: 0.9, description: "on the floor" };
const onSofa: FrameVerdict = { person_visible: true, posture: "lying", on_floor: false, fall_detected: false, confidence: 0.9, description: "lying on the sofa" };
const sitting: FrameVerdict = { person_visible: true, posture: "sitting", on_floor: false, fall_detected: false, confidence: 0.8, description: "sitting" };
const nobody: FrameVerdict = { person_visible: false, posture: "unknown", on_floor: false, fall_detected: false, confidence: 0.9, description: "empty room" };

/** Feeds verdicts at 2 frames per second and returns every event. */
function run(verdicts: FrameVerdict[], detector = new FallDetector(DEFAULT_FALL_CONFIG)): FallEvent[] {
  return verdicts.flatMap((v, i) => detector.update(v, i * 0.5).events);
}

const repeat = (v: FrameVerdict, n: number) => Array<FrameVerdict>(n).fill(v);

describe("FallDetector", () => {
  it("confirms a fall once the person stays down for 2 s over several frames", () => {
    const events = run([...repeat(standing, 4), ...repeat(fallen, 6)]);
    expect(events.map((e) => e.kind)).toEqual(["possible_fall", "fall_confirmed"]);
    expect(events[0].t).toBe(2);
    expect(events[1].t).toBe(4); // 2 s after the first "down" frame
  });

  it("does not confirm on a single bad frame", () => {
    const events = run([...repeat(standing, 4), fallen, ...repeat(standing, 4)]);
    expect(events.map((e) => e.kind)).toEqual(["possible_fall", "fall_cancelled"]);
  });

  it("ignores someone lying on a sofa", () => {
    expect(run([...repeat(standing, 2), ...repeat(onSofa, 10)])).toEqual([]);
  });

  it("trusts the model when it says someone on the floor did not fall", () => {
    const onRug: FrameVerdict = { ...fallen, fall_detected: false, confidence: 0.95, description: "lying on the rug on purpose" };
    expect(run([...repeat(standing, 2), ...repeat(onRug, 10)])).toEqual([]);
  });

  it("does not confirm from two isolated down frames separated by sitting", () => {
    const events = run([standing, fallen, ...repeat(sitting, 8), fallen, ...repeat(sitting, 8)]);
    expect(events.map((e) => e.kind)).not.toContain("fall_confirmed");
  });

  it("restarts the confirmation window after a contradicting frame", () => {
    // down at 0.5, sitting at 1.0, then down from 1.5: confirmation needs 2 s from 1.5, i.e. at 3.5.
    const events = run([standing, fallen, sitting, ...repeat(fallen, 6)]);
    expect(events.map((e) => e.kind)).toEqual(["possible_fall", "fall_confirmed"]);
    expect(events[1].t).toBe(3.5);
  });

  it("ignores low-confidence fall verdicts", () => {
    expect(run(repeat({ ...fallen, confidence: 0.3 }, 10))).toEqual([]);
  });

  it("keeps waiting while the person is briefly out of view", () => {
    const events = run([standing, fallen, nobody, nobody, fallen, fallen]);
    expect(events.map((e) => e.kind)).toEqual(["possible_fall", "fall_confirmed"]);
  });

  it("cancels a candidate when nobody is down for longer than the timeout", () => {
    const events = run([standing, fallen, ...repeat(sitting, 25)]);
    expect(events.map((e) => e.kind)).toEqual(["possible_fall", "fall_cancelled"]);
  });

  it("reports recovery when a fallen person gets back up", () => {
    const events = run([...repeat(fallen, 6), ...repeat(standing, 3)]);
    expect(events.map((e) => e.kind)).toEqual(["possible_fall", "fall_confirmed", "recovered"]);
  });

  it("needs several upright frames to recover, not one", () => {
    const events = run([...repeat(fallen, 6), standing, fallen, standing]);
    expect(events.map((e) => e.kind)).toEqual(["possible_fall", "fall_confirmed"]);
  });
});
