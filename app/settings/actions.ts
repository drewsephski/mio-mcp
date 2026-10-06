"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { callSmsFunction } from "@/lib/sms";
import { preferencesSchema, type Preferences } from "@/lib/companion-models";
import { getActionError } from "@/lib/errors";

const clock = z.union([z.literal(""), z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use a valid time for quiet hours.")]);
const inputSchema = z.object({
  timezone: z.string().min(1, "Choose a timezone.").max(100).refine((value) => { try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; } }, "Choose a valid IANA timezone, such as America/Chicago."),
  defaultOffsetMinutes: z.number().int().min(0).max(10080), quietHoursStart: clock, quietHoursEnd: clock,
}).strict().refine((value) => (!value.quietHoursStart && !value.quietHoursEnd) || (!!value.quietHoursStart && !!value.quietHoursEnd && value.quietHoursStart !== value.quietHoursEnd), "Set both quiet hours to different times, or leave both empty.");

export type PreferencesResult = { ok: true; data: Preferences } | { ok: false; error: string; refreshRequired: boolean };
export async function savePreferences(input: z.infer<typeof inputSchema>): Promise<PreferencesResult> {
  const validated = inputSchema.safeParse(input);
  if (!validated.success) return { ok: false, error: getActionError(validated.error), refreshRequired: false };
  try {
    const data = preferencesSchema.parse(await callSmsFunction("/preferences", { body: validated.data }));
    revalidatePath("/settings"); revalidatePath("/today");
    return { ok: true, data };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: getActionError(error), refreshRequired: true };
  }
}
