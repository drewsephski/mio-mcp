import { Account, AppwriteException, Client, Messaging, TablesDB, Users } from "node-appwrite";
import twilio from "twilio";
import { z } from "zod";
import { inviteEmails, hasVerifiedBetaAccess } from "./beta.ts";
import { digest } from "./inbound.ts";
import { createUsageControls, usageLimitsFromEnv, UsageLimitError } from "./usage.ts";
import { optOut, parseInbound, SmsError } from "./inbound.ts";
import { createSmsService } from "./service.ts";

type Context = {
  req: { method: string; path: string; queryString: string; bodyText: string; headers: Record<string, string> };
  res: { json(data: unknown, status?: number): unknown; text(body: string, status?: number, headers?: Record<string, string>): unknown };
  error(message: string): void;
  log?(message: string): void;
};

const schema = z.object({
  endpoint: z.url(), projectId: z.string().min(1), databaseId: z.string().min(1), providerId: z.string().min(1),
  accountSid: z.string().regex(/^AC[a-f0-9]{32}$/i), authToken: z.string().min(1),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/), webhookUrl: z.url().startsWith("https://"),
  fallbackUrl: z.url().startsWith("https://").optional(),
  supportEmail: z.email().default("drewsepeczi@gmail.com"),
});
const accountPaths = ["/status", "/challenge", "/disconnect", "/reminders", "/activity", "/preferences", "/reminders/update", "/reminders/cancel", "/usage"];
const xml = (text: string) => text.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);

export default async function main({ req, res, error, log }: Context) {
  try {
    const config = schema.parse({
      endpoint: process.env.APPWRITE_FUNCTION_API_ENDPOINT, projectId: process.env.APPWRITE_FUNCTION_PROJECT_ID,
      databaseId: process.env.APPWRITE_DATABASE_ID ?? "mio", providerId: process.env.APPWRITE_SMS_PROVIDER_ID,
      accountSid: process.env.TWILIO_ACCOUNT_SID, authToken: process.env.TWILIO_AUTH_TOKEN,
      phone: process.env.MIO_PHONE_NUMBER, webhookUrl: process.env.TWILIO_WEBHOOK_URL,
      supportEmail: process.env.MIO_SUPPORT_EMAIL || undefined,
      fallbackUrl: process.env.MIO_NUMBER_MODE === "legacy-shared" ? process.env.TWILIO_FALLBACK_SMS_URL || undefined : undefined,
    });
    const client = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setKey(req.headers["x-appwrite-key"]);
    const tables = new TablesDB(client);
    const invitedEmails = inviteEmails(process.env.MIO_INVITE_EMAILS);
    const usage = createUsageControls(tables, { databaseId: config.databaseId, limits: usageLimitsFromEnv(process.env) });
    const service = createSmsService(tables, new Users(client), new Messaging(client), {
      ...config, apiKey: process.env.OPENROUTER_API_KEY, model: process.env.MIO_AI_MODEL ?? "openai/gpt-5.6-luna",
      timezone: process.env.MIO_DEFAULT_TIMEZONE ?? "America/Chicago",
      defaultOffsetMinutes: Number(process.env.MIO_REMINDER_OFFSET_MINUTES ?? 15), invitedEmails, usage, log,
    });
    if (req.headers["x-appwrite-trigger"] === "schedule") {
      return res.json(await service.work());
    }
    if (req.headers["x-appwrite-trigger"] === "event") {
      // Appwrite supplies trigger/event headers; no public worker HTTP route.
      const event = req.headers["x-appwrite-event"] ?? "";
      const queued = event.startsWith(`tablesdb.${config.databaseId}.tables.sms_jobs.rows.`) && event.endsWith(".create");
      const noteChanged = event.startsWith(`tablesdb.${config.databaseId}.tables.notes.rows.`) && (event.endsWith(".update") || event.endsWith(".delete"));
      const reminderChanged = event.startsWith(`tablesdb.${config.databaseId}.tables.reminders.rows.`) && event.endsWith(".update");
      if (!queued && !noteChanged && !reminderChanged) return res.json({ ignored: true });
      const job = z.object({ ownerId: z.string().min(1).max(36), syncPending: z.boolean().optional() }).parse(JSON.parse(req.bodyText));
      // Reconciliation itself updates reminders. Only new pending intent wakes
      // an event worker; completed sync updates must not recursively trigger it.
      if (reminderChanged && job.syncPending !== true) return res.json({ ignored: true });
      return res.json(await service.work(job.ownerId));
    }
    if (accountPaths.includes(req.path)) {
      const read = ["/status", "/reminders", "/activity", "/preferences", "/usage"].includes(req.path);
      const allowed = req.path === "/preferences" ? ["GET", "POST"] : [read ? "GET" : "POST"];
      if (!allowed.includes(req.method)) return res.json({ error: "Method not allowed" }, 405);
      const jwt = req.headers["x-appwrite-user-jwt"];
      if (!jwt) return res.json({ error: "Sign in to continue" }, 401);
      const userClient = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setJWT(jwt);
      const user = await new Account(userClient).get();
      if (!user.status) return res.json({ error: "Account unavailable" }, 403);
      const params = Object.fromEntries(new URLSearchParams(req.queryString));
      if (req.path === "/status") return res.json(await service.status(user.$id));
      if (req.path === "/disconnect") { await service.disconnect(user.$id); return res.json(await service.status(user.$id)); }
      if (!hasVerifiedBetaAccess(user, invitedEmails)) throw new SmsError("Mio is invite-only. Verify the email address on your invitation.", 403);
      if (Buffer.byteLength(req.bodyText) > 8192) throw new SmsError("Request too large", 413);
      let input: unknown = {};
      if (req.method === "POST") {
        try { input = JSON.parse(req.bodyText || "{}"); } catch { throw new SmsError("Invalid request", 400); }
      }
      if (req.path === "/challenge") {
        const consent = z.object({ consent: z.literal(true), consentVersion: z.literal("2026-10-06") }).strict().safeParse(input);
        if (!consent.success) throw new SmsError("Agree to the SMS terms before connecting.", 400);
        return res.json(await service.challenge(user.$id, consent.data.consentVersion));
      }
      if (req.path === "/reminders") return res.json(await service.companion.reminders(user.$id, params));
      if (req.path === "/activity") return res.json(await service.companion.activity(user.$id, params));
      if (req.path === "/preferences") return res.json(req.method === "GET" ? await service.companion.preferences(user.$id) : await service.companion.savePreferences(user.$id, input));
      if (req.path === "/reminders/update") return res.json(await service.companion.updateReminder(user.$id, input));
      if (req.path === "/reminders/cancel") return res.json(await service.companion.cancelReminder(user.$id, input));
      if (req.path === "/usage") return res.json(await usage.daily(user.$id));
    }
    if (req.path !== "/inbound") return res.json({ error: "Not found" }, 404);
    if (req.method !== "POST") return res.text("Method not allowed", 405);
    if (req.queryString || !req.headers["content-type"]?.toLowerCase().startsWith("application/x-www-form-urlencoded")) return res.text("Invalid request", 415);
    const { message, params } = parseInbound(req.bodyText, req.headers["x-twilio-signature"], config);
    // Advanced Opt-Out in the dedicated Messaging Service already sends HELP.
    if (message.OptOutType?.toUpperCase() === "HELP") return res.text("<Response/>", 200, { "content-type": "text/xml" });
    const control = optOut(message.Body, message.OptOutType);
    if (control) {
      const connection = await service.byPhone(message.From);
      if (connection && control === "stop") await service.disconnect(connection.ownerId);
      // Twilio owns opt-out acknowledgements. START does not silently re-bind
      // the number; the user must generate a fresh connection code in Mio.
      return res.text("<Response/>", 200, { "content-type": "text/xml" });
    }
    const result = await service.inbound(message);
    if (!result.handled && config.fallbackUrl) {
      // The shared number remains a Vapi number. Unconnected senders retain
      // its prior SMS workflow. Sign for the exact upstream URL, not Mio's URL.
      const response = await fetch(config.fallbackUrl, {
        method: "POST", body: req.bodyText, redirect: "error", signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": twilio.getExpectedTwilioSignature(config.authToken, config.fallbackUrl, params) },
      });
      if (!response.ok) throw new SmsError("Upstream SMS unavailable", 503);
      const body = await response.text();
      if (Buffer.byteLength(body) > 32_768) throw new SmsError("Upstream response too large", 503);
      return res.text(body, 200, { "content-type": "text/xml" });
    }
    const notice = ("notice" in result ? result.notice : undefined) ?? (!result.handled ? "Connect your phone in Mio before saving notes by text." : null);
    if (notice) await usage.reserve({ ownerId: `anon_${digest(message.From).slice(0, 30)}`, operationId: `${message.MessageSid}:notice`, kind: "outbound" });
    return res.text(notice ? `<Response><Message>${xml(notice)}</Message></Response>` : "<Response/>", 200, { "content-type": "text/xml" });
  } catch (cause) {
    // No phone numbers, note content, tokens, raw requests, or credentials in logs.
    const accountRequest = accountPaths.includes(req.path);
    // Accept throttled inbound traffic silently so Twilio does not retry it.
    if (cause instanceof UsageLimitError && !accountRequest) return res.text("<Response/>", 200, { "content-type": "text/xml" });
    // Backend permission failures are retryable webhook failures. Only user
    // session failures on account endpoints should become HTTP 401/403.
    const status = cause instanceof SmsError ? cause.status : accountRequest && cause instanceof AppwriteException && [401, 403].includes(cause.code) ? cause.code : 503;
    error(`SMS request failed (${status}; ${cause instanceof AppwriteException ? cause.type : "request"})`);
    return res.json({ error: status === 503 ? "Temporarily unavailable" : accountRequest && cause instanceof SmsError ? cause.message : "Request rejected" }, status);
  }
}
