"use server";

import { callSmsFunction, getSmsStatus, smsChallengeSchema, type SmsChallenge, type SmsStatus, SMS_CONSENT_VERSION } from "@/lib/sms";
import { getActionError } from "@/lib/errors";
import type { ActionResult } from "@/lib/models";

export async function createSmsConnection(consent: boolean): Promise<ActionResult<SmsChallenge>> {
  try {
    if (consent !== true) return { ok: false, error: "Agree to receive Mio messages before connecting your phone." };
    return { ok: true, data: smsChallengeSchema.parse(await callSmsFunction("/challenge", { body: { consent: true, consentVersion: SMS_CONSENT_VERSION } })) };
  }
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
