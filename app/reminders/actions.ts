"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { callSmsFunction } from "@/lib/sms";
import { resourceIdSchema } from "@/lib/notes-validation";
import { getActionError } from "@/lib/errors";

const reminderInput = z.object({ id: resourceIdSchema, revision: z.number().int().positive() }).strict();
const updateInput = reminderInput.extend({
  eventLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose an event date and time."),
  timezone: z.string().min(1).max(100), offsetMinutes: z.number().int().min(0).max(10080), message: z.string().trim().min(1).max(500),
});
export type ReminderActionResult = { ok: true } | { ok: false; error: string; refreshRequired: boolean };

async function mutate(path: "/reminders/update" | "/reminders/cancel", schema: z.ZodType, input: unknown): Promise<ReminderActionResult> {
  try {
    await callSmsFunction(path, { body: schema.parse(input) });
    revalidatePath("/reminders"); revalidatePath("/today"); revalidatePath("/activity");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: getActionError(error), refreshRequired: !(error instanceof z.ZodError) };
  }
}
export async function updateReminder(input: z.infer<typeof updateInput>) { return mutate("/reminders/update", updateInput, input); }
export async function cancelReminder(input: z.infer<typeof reminderInput>) { return mutate("/reminders/cancel", reminderInput, input); }
