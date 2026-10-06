import { z } from "zod";
import { usageLimitsFromEnv } from "../../functions/mio-sms/src/usage.ts";
import { configureAdmission } from "./admission.mjs";
export async function preflight(ctx) {
  const invited = (process.env.MIO_INVITE_EMAILS ?? "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  invited.forEach(x => z.email().parse(x));
  if (!invited.length) throw new Error("MIO_INVITE_EMAILS is required; use an explicit closed-admission maintenance procedure for an empty list");
  const token = process.env.MIO_OPERATIONS_TOKEN;
  if (!token || token.length < 32) throw new Error("MIO_OPERATIONS_TOKEN must contain at least 32 characters");
  z.email().parse(process.env.MIO_SUPPORT_EMAIL);
  if (!process.env.MIO_OPERATOR_NAME?.trim()) throw new Error("MIO_OPERATOR_NAME is required");
  const limits = usageLimitsFromEnv(process.env);
  const fn = await ctx.functions.get({ functionId: "mio-sms" });
  const site = await ctx.sites.get({ siteId: "mio-web" });
  if (fn.providerRepositoryId || site.providerRepositoryId) throw new Error("Independent VCS auto-deploy must be disabled before coordinated beta releases");
  for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "APPWRITE_SMS_PROVIDER_ID", "MIO_PHONE_NUMBER", "TWILIO_WEBHOOK_URL", "OPENROUTER_API_KEY"]) if (!fn.vars.some(x => x.key === key)) throw new Error(`Function variable is missing: ${key}`);
  for (const key of ["APPWRITE_API_KEY", "APP_URL", "NEXT_PUBLIC_APPWRITE_ENDPOINT", "NEXT_PUBLIC_APPWRITE_PROJECT_ID"]) if (!site.vars.some(x => x.key === key)) throw new Error(`Site variable is missing: ${key}`);
  const vars = Object.fromEntries(fn.vars.filter(x => !x.secret).map(x => [x.key, x.value]));
  const webhook = z.url().parse(vars.TWILIO_WEBHOOK_URL);
  if (!webhook.startsWith("https://") || new URL(webhook).pathname !== "/inbound") throw new Error("Function webhook configuration is invalid");
  const siteUrl = site.vars.find(x => x.key === "APP_URL").value;
  if (!siteUrl.startsWith("https://")) throw new Error("Production Site must use HTTPS");
  const admission = await configureAdmission(ctx, invited, false);
  return { invited, token, limits, fn, site, webhook, siteUrl, admission };
}
