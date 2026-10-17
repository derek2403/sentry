// Types shared by the API routes and the dashboard.

export type Posture = "standing" | "walking" | "sitting" | "bending" | "lying" | "unknown";

export type EmergencyType = "none" | "fall" | "fire_smoke" | "water_leak" | "medical" | "child_danger" | "intruder" | "other";

/** Nemotron's answer for one video frame. */
export interface FrameVerdict {
  emergency: boolean;
  type: EmergencyType; // "none" when there is no emergency
  person_visible: boolean;
  posture: Posture;
  on_floor: boolean;
  confidence: number; // 0..1, how sure the model is about `emergency`
  description: string;
}

// The state machine started with falls; it now handles every emergency type. The names stay.
export type FallState = "monitoring" | "candidate" | "confirmed";

export type FallEventKind = "possible_fall" | "fall_confirmed" | "fall_cancelled" | "recovered";

export interface FallEvent {
  kind: FallEventKind;
  type: EmergencyType;
  t: number; // seconds into the video / camera session
  detail: string;
}

export type LogLevel = "info" | "warning" | "critical" | "error";

export type LogKind =
  | "system"
  | "video"
  | "frame"
  | "error"
  | "workflow"
  | "alert"
  | FallEventKind;

export interface LogEntry {
  id: number;
  ts: number; // unix ms
  level: LogLevel;
  kind: LogKind;
  source: string | null; // display name, e.g. "1A Living room"
  camera: string | null; // camera id, e.g. "living"
  message: string;
  snapshot: string | null; // URL of a locally stored frame
  data: Record<string, unknown> | null;
}

/** `data` of a log entry with kind "frame": one LLM answer and whether it saw an emergency. */
export interface LlmLogData {
  emergency: boolean;
  type: EmergencyType;
  fall: boolean; // type === "fall"; kept for older entries and clients

  output: string; // the model's reply, exactly as returned
  t: number | null; // seconds into the video / camera session
  confidence: number | null;
  model: string | null;
  latencyMs: number | null;
  verdict: FrameVerdict | null;
}

export interface Alert {
  eventId: number;
  ts: number;
  location: string;
  camera: string | null;
  type: EmergencyType;
  description: string; // what Nemotron saw in the frame that confirmed it
  message: string;
  snapshot: string | null;
  videoTime: number;
}

export type SourceKind = "upload" | "camera";

export interface SessionInfo {
  id: string;
  source: SourceKind;
  name: string; // display name, e.g. "1A Living room"
  camera: string | null; // camera id, e.g. "living"
}

export interface FrameResult {
  verdict: FrameVerdict | null;
  state: FallState;
  events: FallEvent[];
  latencyMs: number;
  error?: string;
  alert: Alert | null;
}

export interface StatusResponse {
  alert: Alert | null;
  model: { id: string | null; baseUrl: string; reachable: boolean; error: string | null };
  analysis: { intervalS: number; maxFrameWidth: number; holdLastFrameS: number };
  cameraName: string;
  activeSessions: number;
}
