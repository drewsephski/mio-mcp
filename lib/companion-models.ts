import { z } from "zod";

export const reminderSchema = z.object({
  id: z.string(), noteId: z.string(), eventAt: z.string(), remindAt: z.string(),
  timezone: z.string(), message: z.string(), status: z.string(), revision: z.number().int(),
  syncPending: z.boolean(), lastError: z.string().nullish(),
});
export const remindersPageSchema = z.object({ items: z.array(reminderSchema), nextCursor: z.string().nullable() });
export const activityPageSchema = z.object({
  items: z.array(z.object({
    id: z.string(), createdAt: z.string(), userText: z.string(), reply: z.string(),
    notes: z.array(z.object({ id: z.string(), title: z.string() })), reminderIds: z.array(z.string()),
  })), nextCursor: z.string().nullable(),
});
export const preferencesSchema = z.object({
  timezone: z.string(), defaultOffsetMinutes: z.number().int(), quietHoursStart: z.string(), quietHoursEnd: z.string(),
  smsEnabled: z.boolean(), proactiveMessagesEnabled: z.literal(false), dailyDigestEnabled: z.literal(false),
});
export type Reminder = z.infer<typeof reminderSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export const usageSchema = z.object({
  date: z.string(), inboundSms: z.number(), outboundSms: z.number(), aiTurns: z.number(), inputTokens: z.number(), outputTokens: z.number(),
  aiReservedMicros: z.number(), smsReservedMicros: z.number(),
  limits: z.object({ inboundPerMinute: z.number(), aiPerHour: z.number(), aiPerDay: z.number(), outboundPerDay: z.number(), maxActiveReminders: z.number(), maxScheduledOutbound: z.number() }),
  globalLimited: z.object({ ai: z.boolean(), sms: z.boolean() }),
});

export function formatMoment(value: string, timezone: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...options }).format(new Date(value));
}

export function localDateTime(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function reminderStatus(reminder: Reminder) {
  if (reminder.syncPending) return ["cancelled", "canceled"].includes(reminder.status) ? "Cancellation pending" : "Schedule update pending";
  if (reminder.status === "active") return "Scheduled";
  return ({ scheduled: "Scheduled", sent: "Sent", delivered: "Delivered", canceled: "Cancelled", cancelled: "Cancelled", failed: "Delivery failed", pending: "Pending" } as Record<string, string>)[reminder.status] ?? reminder.status;
}
