import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export const timezoneSchema = z.string().max(64).refine((zone) => {
  try { Temporal.Now.zonedDateTimeISO(zone); return !/^[+-]/.test(zone); } catch { return false; }
}, "Use an IANA timezone such as America/Chicago");
export const localTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/, "Use YYYY-MM-DDTHH:mm in the user's timezone");

export function localToInstant(local: string, timezone: string) {
  timezoneSchema.parse(timezone);
  // Reject both nonexistent spring times and ambiguous fall times. Ask the
  // user for an explicit offset rather than silently moving their appointment.
  return Temporal.PlainDateTime.from(localTimeSchema.parse(local))
    .toZonedDateTime(timezone, { disambiguation: "reject" }).toInstant().toString();
}
export function reminderTimes(eventLocal: string, timezone: string, offsetMinutes: number, remindLocal?: string) {
  const eventAt = localToInstant(eventLocal, timezone);
  const remindAt = remindLocal ? localToInstant(remindLocal, timezone)
    : Temporal.Instant.from(eventAt).subtract({ minutes: offsetMinutes }).toString();
  if (Temporal.Instant.compare(remindAt, eventAt) > 0) throw new Error("The notification must be at or before the event");
  return { eventAt, remindAt };
}
export function localNow(now: Date, timezone: string) {
  return Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(timezone).toPlainDateTime().toString();
}
