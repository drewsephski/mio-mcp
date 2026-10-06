import "server-only";
import { callSmsFunction } from "./sms";
import { activityPageSchema, preferencesSchema, remindersPageSchema, usageSchema } from "./companion-models";
import { resourceIdSchema } from "./notes-validation";

export async function getReminders(view: "upcoming" | "history" = "upcoming", cursor?: string) {
  return remindersPageSchema.parse(await callSmsFunction("/reminders", { query: { view, cursor: cursor ? resourceIdSchema.parse(cursor) : undefined } }));
}

export async function getActivity(cursor?: string) {
  return activityPageSchema.parse(await callSmsFunction("/activity", { query: { cursor: cursor ? resourceIdSchema.parse(cursor) : undefined } }));
}

export async function getPreferences() {
  return preferencesSchema.parse(await callSmsFunction("/preferences"));
}

export async function getUsage() { return usageSchema.parse(await callSmsFunction("/usage")); }
