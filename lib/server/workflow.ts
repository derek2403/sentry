import "server-only";

import type { Alert } from "../types";
import type { EventLog } from "./events";

/**
 * Entry point for the emergency workflow, called once per confirmed fall.
 *
 * Next steps (see demo.md): send the Telegram text alert to the admin, start
 * the 3-minute timer, call the emergency contact, explain what happened and
 * what to do, then ask whether to call emergency services.
 */
export async function onFallConfirmed(alert: Alert, log: EventLog): Promise<void> {
  log.add({
    kind: "workflow",
    level: "warning",
    source: alert.location,
    camera: alert.camera,
    message: "Emergency workflow triggered (Telegram alert and emergency call not connected yet)",
    data: { eventId: alert.eventId },
  });
}
