"use server";

import { callSmsFunction, getSmsStatus, smsChallengeSchema, type SmsChallenge, type SmsStatus } from "@/lib/sms";
import { getActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/models";

export async function createSmsConnection(): Promise<ActionResult<SmsChallenge>> {
  try { return { ok: true, data: smsChallengeSchema.parse(await callSmsFunction("/challenge")) }; }
  catch (error) { return { ok: false, error: getActionError(error) }; }
}
export async function disconnectSms(): Promise<ActionResult<SmsStatus>> {
  try { await callSmsFunction("/disconnect"); return { ok: true, data: await getSmsStatus() }; }
  catch (error) { return { ok: false, error: getActionError(error) }; }
}
export async function refreshSmsStatus(): Promise<ActionResult<SmsStatus>> {
  try { return { ok: true, data: await getSmsStatus() }; }
  catch (error) { return { ok: false, error: getActionError(error) }; }
}
