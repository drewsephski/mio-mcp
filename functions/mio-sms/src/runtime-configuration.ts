import { z } from "zod";
import { inviteEmails } from "./beta.ts";
import { usageLimitsFromEnv } from "./usage.ts";

// Readiness reports only a boolean. Never return environment values or parser
// input/errors, which may contain a credential or private invitation address.
export function runtimeConfigurationReady(env: Record<string, string | undefined>) {
  try {
    z.object({
      endpoint: z.url().startsWith("https://"), project: z.string().min(1), provider: z.string().min(1),
      accountSid: z.string().regex(/^AC[a-f0-9]{32}$/i), authToken: z.string().min(1),
      phone: z.string().regex(/^\+[1-9]\d{7,14}$/), webhook: z.url().startsWith("https://"),
      aiKey: z.string().min(1), mode: z.literal("dedicated"), operator: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/),
      token: z.string().min(32), support: z.email(),
    }).parse({ endpoint: env.APPWRITE_FUNCTION_API_ENDPOINT, project: env.APPWRITE_FUNCTION_PROJECT_ID, provider: env.APPWRITE_SMS_PROVIDER_ID,
      accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, phone: env.MIO_PHONE_NUMBER, webhook: env.TWILIO_WEBHOOK_URL,
      aiKey: env.OPENROUTER_API_KEY, mode: env.MIO_NUMBER_MODE, operator: env.MIO_OPERATOR_USER_ID, token: env.MIO_OPERATIONS_TOKEN, support: env.MIO_SUPPORT_EMAIL });
    inviteEmails(env.MIO_INVITE_EMAILS);
    usageLimitsFromEnv(env);
    new Intl.DateTimeFormat("en-US", { timeZone: env.MIO_DEFAULT_TIMEZONE ?? "America/Chicago" });
    const offset = Number(env.MIO_REMINDER_OFFSET_MINUTES ?? 15);
    return Number.isSafeInteger(offset) && offset >= 0 && offset <= 10080;
  } catch { return false; }
}
