// Types shared by the API routes and the dashboard.

export type Posture = "standing" | "walking" | "sitting" | "bending" | "lying" | "unknown";

/** Nemotron's answer for one video frame. */
export interface FrameVerdict {
  person_visible: boolean;
  posture: Posture;
  on_floor: boolean;
  fall_detected: boolean;
  confidence: number; // 0..1
  description: string;
}

export type FallState = "monitoring" | "candidate" | "confirmed";

export type FallEventKind = "possible_fall" | "fall_confirmed" | "fall_cancelled" | "recovered";

export interface FallEvent {
  kind: FallEventKind;
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

/** `data` of a Backlog entry with kind "frame": one LLM answer and whether it saw a fall. */
export interface LlmLogData {
  fall: boolean;
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
