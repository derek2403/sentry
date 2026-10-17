// Emergency types and their labels, shared by the server and the dashboard.

import type { EmergencyType } from "./types";

export const EMERGENCY_TYPES: EmergencyType[] = ["none", "fall", "fire_smoke", "water_leak", "medical", "child_danger", "intruder", "other"];

export const EMERGENCY_LABELS: Record<EmergencyType, string> = {
  none: "No emergency",
  fall: "Fall",
  fire_smoke: "Fire or smoke",
  water_leak: "Water leak",
  medical: "Medical emergency",
  child_danger: "Child in danger",
  intruder: "Intruder or violence",
  other: "Emergency",
};

export const emergencyLabel = (type: EmergencyType | undefined | null) => EMERGENCY_LABELS[type ?? "other"] ?? "Emergency";
