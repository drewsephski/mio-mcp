import "server-only";
import { release } from "@/functions/mio-sms/src/release.generated";
import { ExecutionMethod, Functions } from "node-appwrite";
import { z } from "zod";
import { requireSession } from "./appwrite";
import { NotesError } from "./notes-service";

export const SMS_CONSENT_VERSION = "2026-10-06";
export const smsStatusSchema = z.object({ connected: z.boolean(), phone: z.string().nullable(), mioPhone: z.string(), timezone: z.string().default("America/Chicago"), defaultOffsetMinutes: z.number().int().default(15) });
export const smsChallengeSchema = z.object({ code: z.string().regex(/^[a-f0-9]{32}$/), expiresAt: z.iso.datetime(), mioPhone: z.string() });
export type SmsStatus = z.infer<typeof smsStatusSchema>;
export type SmsChallenge = z.infer<typeof smsChallengeSchema>;
type SmsPath = "/status" | "/challenge" | "/disconnect" | "/reminders" | "/activity" | "/preferences" | "/reminders/update" | "/reminders/cancel" | "/usage" | "/operator" | "/visit" | "/admission";

export async function callSmsFunction(path: SmsPath, options: { query?: Record<string, string | undefined>; body?: unknown } = {}) {
  const { client } = await requireSession();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) query.set(key, value);
  const read = ["/status", "/reminders", "/activity", "/preferences", "/usage", "/operator", "/admission"].includes(path) && options.body === undefined;
  const execution = await new Functions(client).createExecution({
    functionId: process.env.APPWRITE_SMS_FUNCTION_ID ?? "mio-sms", xpath: `${path}${query.size ? `?${query}` : ""}`,
    method: read ? ExecutionMethod.GET : ExecutionMethod.POST,
    body: options.body === undefined ? undefined : JSON.stringify(options.body), async: false, headers: { "x-mio-release-id": release.releaseId },
  });
  if (execution.responseStatusCode < 200 || execution.responseStatusCode >= 300) {
    const status = execution.responseStatusCode;
    let message = "Mio is temporarily unavailable. Refresh to check its status before trying again.";
    try {
      const result = z.object({ error: z.string().max(500) }).parse(JSON.parse(execution.responseBody));
      if ([400, 403, 404, 409, 429].includes(status)) message = result.error;
    } catch { /* An unavailable function may return an HTML error page. */ }
    throw new NotesError(message, status || 503);
  }
  return JSON.parse(execution.responseBody) as unknown;
}
export async function getSmsStatus() { return smsStatusSchema.parse(await callSmsFunction("/status")); }
