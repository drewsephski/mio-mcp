import "server-only";
import { ExecutionMethod, Functions } from "node-appwrite";
import { z } from "zod";
import { requireSession } from "./appwrite";
import { NotesError } from "./notes-service";

export const smsStatusSchema = z.object({ connected: z.boolean(), phone: z.string().nullable(), mioPhone: z.string(), timezone: z.string().default("America/Chicago"), defaultOffsetMinutes: z.number().int().default(15) });
export const smsChallengeSchema = z.object({ code: z.string().regex(/^[a-f0-9]{32}$/), expiresAt: z.iso.datetime(), mioPhone: z.string() });
export type SmsStatus = z.infer<typeof smsStatusSchema>;
export type SmsChallenge = z.infer<typeof smsChallengeSchema>;

export async function callSmsFunction(path: "/status" | "/challenge" | "/disconnect") {
  const { client } = await requireSession();
  const execution = await new Functions(client).createExecution({
    functionId: process.env.APPWRITE_SMS_FUNCTION_ID ?? "mio-sms", xpath: path,
    method: path === "/status" ? ExecutionMethod.GET : ExecutionMethod.POST,
    async: false,
  });
  if (execution.responseStatusCode < 200 || execution.responseStatusCode >= 300) {
    const status = execution.responseStatusCode;
    throw new NotesError(status === 409 ? "Disconnect your current phone before connecting another." : "SMS settings are temporarily unavailable. Please try again shortly.", status || 503);
  }
  return JSON.parse(execution.responseBody) as unknown;
}

export async function getSmsStatus() { return smsStatusSchema.parse(await callSmsFunction("/status")); }
