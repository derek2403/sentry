// Turns Nemotron's per-frame verdicts into fall events.
//
//   monitoring --(a frame shows someone down)-----------------------> candidate
//   candidate  --(still down for confirmFrames and confirmSeconds)--> confirmed
//   candidate  --(back on their feet, or not down for a while)------> monitoring
//   confirmed  --(back on their feet)-------------------------------> monitoring
//
// One frame can be wrong, so a fall is only confirmed after several frames
// spread over a few seconds agree, with no clear "sitting or standing" frame
// in between. Unclear frames (person hidden, low confidence) are neutral.
//
// No server-only import here so it can be unit-tested directly.

import type { FallEvent, FallState, FrameVerdict } from "../types";

export interface FallConfig {
  confirmFrames: number;
  confirmSeconds: number;
  recoverFrames: number;
  minConfidence: number;
  candidateTimeoutS: number;
}

export const DEFAULT_FALL_CONFIG: FallConfig = {
  confirmFrames: 2,
  confirmSeconds: 2,
  recoverFrames: 2,
  minConfidence: 0.5,
  candidateTimeoutS: 10,
};

/** Nemotron says this frame shows a fall, and is confident about it. */
export function isDown(v: FrameVerdict, minConfidence: number): boolean {
  // fall_detected is the model's judgement; on_floor/lying alone is not enough
  // (someone lying on a rug on purpose is on the floor too).
  return v.person_visible && v.fall_detected && v.confidence >= minConfidence;
}

export function isUp(v: FrameVerdict): boolean {
  // on_floor is ignored here: the model sets it for people standing on the floor too.
  return v.person_visible && !v.fall_detected && (v.posture === "standing" || v.posture === "walking");
}

/** A clear frame that contradicts "they are down": sitting up, standing or walking. */
function contradictsFall(v: FrameVerdict, minConfidence: number): boolean {
  return v.person_visible && !v.fall_detected && v.confidence >= minConfidence && (v.posture === "sitting" || isUp(v));
}

export class FallDetector {
  state: FallState = "monitoring";
  private candidateT = 0;
  private lastDownT = 0;
  private downFrames = 0;
  private upStreak = 0;

  constructor(private readonly cfg: FallConfig = DEFAULT_FALL_CONFIG) {}

  update(v: FrameVerdict, t: number): { state: FallState; events: FallEvent[] } {
    const events: FallEvent[] = [];
    const emit = (kind: FallEvent["kind"], detail: string) => events.push({ kind, t, detail });

    const down = isDown(v, this.cfg.minConfidence);
    this.upStreak = isUp(v) ? this.upStreak + 1 : 0;
    const gotUp = this.upStreak >= this.cfg.recoverFrames;

    switch (this.state) {
      case "monitoring":
        if (down) {
          this.state = "candidate";
          this.candidateT = this.lastDownT = t;
          this.downFrames = 1;
          emit("possible_fall", v.description);
        }
        break;

      case "candidate":
        if (down) {
          if (this.downFrames === 0) this.candidateT = t; // run of down frames was broken: start again
          this.downFrames += 1;
          this.lastDownT = t;
          if (this.downFrames >= this.cfg.confirmFrames && t - this.candidateT >= this.cfg.confirmSeconds) {
            this.state = "confirmed";
            emit("fall_confirmed", `still down after ${(t - this.candidateT).toFixed(1)}s: ${v.description}`);
          }
          break;
        }
        if (contradictsFall(v, this.cfg.minConfidence)) this.downFrames = 0;
        if (gotUp) {
          this.state = "monitoring";
          emit("fall_cancelled", "person is back on their feet");
        } else if (t - this.lastDownT > this.cfg.candidateTimeoutS) {
          this.state = "monitoring";
          emit("fall_cancelled", "person no longer appears to be down");
        }
        break;

      case "confirmed":
        if (gotUp) {
          this.state = "monitoring";
          emit("recovered", "person is back on their feet");
        }
        break;
    }

    return { state: this.state, events };
  }
}
