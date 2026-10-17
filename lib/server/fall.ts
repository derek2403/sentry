// Turns Nemotron's per-frame verdicts into emergency events (a fall, fire, a water leak, ...).
//
//   monitoring --(a frame shows an emergency)----------------------------> candidate
//   candidate  --(still there for confirmFrames and confirmSeconds)------> confirmed
//   candidate  --(clear frames, or no emergency frame for a while)-------> monitoring
//   confirmed  --(several clear frames in a row)-------------------------> monitoring
//
// One frame can be wrong, so an emergency is only confirmed after several frames
// spread over a few seconds agree, with no clear "everything is normal" frame in
// between. Unclear frames (low confidence, or a fallen person out of view) are neutral.
//
// It started out detecting falls only, hence the names. No server-only import here
// so it can be unit-tested directly.

import type { EmergencyType, FallEvent, FallState, FrameVerdict } from "../types";

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

/** Nemotron says this frame shows an emergency, and is confident about it. */
export function isEmergency(v: FrameVerdict, minConfidence: number): boolean {
  return v.emergency && v.confidence >= minConfidence;
}

/**
 * Nemotron is confident this frame shows no emergency. For a fall the person must be in
 * view: someone hidden behind furniture is not proof they got up.
 */
export function isClear(v: FrameVerdict, minConfidence: number, watching: EmergencyType): boolean {
  if (v.emergency || v.confidence < minConfidence) return false;
  return watching === "fall" || watching === "none" ? v.person_visible : true;
}

export class FallDetector {
  state: FallState = "monitoring";
  /** The emergency being confirmed or confirmed; "none" while monitoring. */
  type: EmergencyType = "none";
  private candidateT = 0;
  private lastDownT = 0;
  private downFrames = 0;
  private clearStreak = 0;

  constructor(private readonly cfg: FallConfig = DEFAULT_FALL_CONFIG) {}

  update(v: FrameVerdict, t: number): { state: FallState; events: FallEvent[] } {
    const events: FallEvent[] = [];
    const emit = (kind: FallEvent["kind"], detail: string) => events.push({ kind, type: this.type, t, detail });

    const down = isEmergency(v, this.cfg.minConfidence);
    const clear = isClear(v, this.cfg.minConfidence, this.type);
    this.clearStreak = clear ? this.clearStreak + 1 : 0;
    const resolved = this.clearStreak >= this.cfg.recoverFrames;

    switch (this.state) {
      case "monitoring":
        if (down) {
          this.state = "candidate";
          this.type = v.type;
          this.candidateT = this.lastDownT = t;
          this.downFrames = 1;
          emit("possible_fall", v.description);
        }
        break;

      case "candidate":
        if (down) {
          if (this.downFrames === 0) this.candidateT = t; // run of emergency frames was broken: start again
          this.downFrames += 1;
          this.lastDownT = t;
          this.type = v.type; // the latest reading wins (e.g. "medical" becomes "fall")
          if (this.downFrames >= this.cfg.confirmFrames && t - this.candidateT >= this.cfg.confirmSeconds) {
            this.state = "confirmed";
            emit("fall_confirmed", `still there after ${(t - this.candidateT).toFixed(1)}s: ${v.description}`);
          }
          break;
        }
        if (clear) this.downFrames = 0;
        if (resolved) {
          emit("fall_cancelled", "the scene looks normal again");
          this.state = "monitoring";
          this.type = "none";
        } else if (t - this.lastDownT > this.cfg.candidateTimeoutS) {
          emit("fall_cancelled", "no emergency seen for a while");
          this.state = "monitoring";
          this.type = "none";
        }
        break;

      case "confirmed":
        if (down) this.type = v.type;
        if (resolved) {
          emit("recovered", "the scene looks normal again");
          this.state = "monitoring";
          this.type = "none";
        }
        break;
    }

    return { state: this.state, events };
  }
}
