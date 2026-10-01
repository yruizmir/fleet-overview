import type { FleetAlert } from "./fleet-model";

export interface NotificationSettings {
  // Notifications paused until then (ms since the epoch), by "Mute all 24h".
  readonly pausedUntil?: number;
  // Off until turned back on, by "Never notify me".
  readonly off: boolean;
}

export const defaultNotificationSettings: NotificationSettings = { off: false };

export const pauseForMs = 24 * 60 * 60 * 1000;
// An alert gone for less than this and back is the same problem: no second notification for it.
export const forgetResolvedAfterMs = 10 * 60_000;

export type NotificationState = { readonly kind: "on" } | { readonly kind: "paused"; readonly until: number } | { readonly kind: "off" };

export const notificationState = (settings: NotificationSettings, now: number): NotificationState =>
  settings.off
    ? { kind: "off" }
    : settings.pausedUntil !== undefined && settings.pausedUntil > now
      ? { kind: "paused", until: settings.pausedUntil }
      : { kind: "on" };

// Which critical alerts to notify about now, given when each was last seen. Every alert firing now is marked
// seen, notified or not: while notifications are paused or off, so that the end of a pause does not bring a
// flood of what happened during it, and while its cluster is warming up, since that is what it already had.
export const selectNotifiable = (
  critical: readonly FleetAlert[],
  seen: Map<string, number>,
  { now, silenced, warmingUp }: { now: number; silenced: boolean; warmingUp: (alert: FleetAlert) => boolean },
): FleetAlert[] => {
  const fresh = silenced ? [] : critical.filter((alert) => !seen.has(alert.key) && !warmingUp(alert));

  critical.forEach((alert) => seen.set(alert.key, now));

  for (const [key, lastSeen] of [...seen]) {
    if (now - lastSeen > forgetResolvedAfterMs) {
      seen.delete(key);
    }
  }

  return fresh;
};
