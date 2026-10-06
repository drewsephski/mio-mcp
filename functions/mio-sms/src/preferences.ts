import { z } from "zod";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const quietHoursSchema = z.object({
  quietHoursStart: z.union([z.literal(""), clock]).default(""),
  quietHoursEnd: z.union([z.literal(""), clock]).default(""),
}).refine(value => (!value.quietHoursStart && !value.quietHoursEnd) ||
  (!!value.quietHoursStart && !!value.quietHoursEnd && value.quietHoursStart !== value.quietHoursEnd),
"Set both quiet-hour times, with different start and end times, or leave both empty.");

export function parsePreferences(row: { timezone?: string; defaultOffsetMinutes?: number; quietHoursStart?: string | null; quietHoursEnd?: string | null; smsEnabled?: boolean | null; proactiveMessagesEnabled?: boolean | null; dailyDigestEnabled?: boolean | null }) {
  return { timezone: row.timezone ?? "America/Chicago", defaultOffsetMinutes: row.defaultOffsetMinutes ?? 15,
    ...quietHoursSchema.parse({ quietHoursStart: row.quietHoursStart || "", quietHoursEnd: row.quietHoursEnd || "" }),
    smsEnabled: row.smsEnabled ?? true, proactiveMessagesEnabled: false as const, dailyDigestEnabled: false as const };
}

export function assertOutsideQuietHours(remindAt: string, timezone: string, preferences: { quietHoursStart?: string | null; quietHoursEnd?: string | null }) {
  const { quietHoursStart: start, quietHoursEnd: end } = parsePreferences(preferences);
  if (!start) return;
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(remindAt));
  const quiet = start < end ? local >= start && local < end : local >= start || local < end;
  if (quiet) throw new Error(`Choose a notification time outside your quiet hours (${start}–${end}, ${timezone}).`);
}
