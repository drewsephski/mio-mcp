import { Account, AppwriteException, Client, Messaging, TablesDB, Users } from "node-appwrite";
import twilio from "twilio";
import { z } from "zod";
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
});
const xml = (text: string) => text.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);

export default async function main({ req, res, error, log }: Context) {
  try {
    const config = schema.parse({
      endpoint: process.env.APPWRITE_FUNCTION_API_ENDPOINT, projectId: process.env.APPWRITE_FUNCTION_PROJECT_ID,
      databaseId: process.env.APPWRITE_DATABASE_ID ?? "mio", providerId: process.env.APPWRITE_SMS_PROVIDER_ID,
      accountSid: process.env.TWILIO_ACCOUNT_SID, authToken: process.env.TWILIO_AUTH_TOKEN,
      phone: process.env.MIO_PHONE_NUMBER, webhookUrl: process.env.TWILIO_WEBHOOK_URL,
      fallbackUrl: process.env.TWILIO_FALLBACK_SMS_URL || undefined,
    });
    const client = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setKey(req.headers["x-appwrite-key"]);
    const service = createSmsService(new TablesDB(client), new Users(client), new Messaging(client), {
      ...config, apiKey: process.env.OPENROUTER_API_KEY, model: process.env.MIO_AI_MODEL ?? "openai/gpt-5.6-luna",
      timezone: process.env.MIO_DEFAULT_TIMEZONE ?? "America/Chicago",
      defaultOffsetMinutes: Number(process.env.MIO_REMINDER_OFFSET_MINUTES ?? 15), log,
    });
    if (req.headers["x-appwrite-trigger"] === "schedule") {
      return res.json(await service.work());
    }
    if (req.headers["x-appwrite-trigger"] === "event") {
      // Appwrite supplies trigger/event headers; no public worker HTTP route.
      const event = req.headers["x-appwrite-event"] ?? "";
      const queued = event.startsWith(`tablesdb.${config.databaseId}.tables.sms_jobs.rows.`) && event.endsWith(".create");
      const noteChanged = event.startsWith(`tablesdb.${config.databaseId}.tables.notes.rows.`) && (event.endsWith(".update") || event.endsWith(".delete"));
      if (!queued && !noteChanged) return res.json({ ignored: true });
      const job = z.object({ ownerId: z.string().min(1).max(36) }).parse(JSON.parse(req.bodyText));
      return res.json(await service.work(job.ownerId));
    }
    if (["/status", "/challenge", "/disconnect"].includes(req.path)) {
      if (req.method !== (req.path === "/status" ? "GET" : "POST")) return res.json({ error: "Method not allowed" }, 405);
      const jwt = req.headers["x-appwrite-user-jwt"];
      if (!jwt) return res.json({ error: "Sign in to continue" }, 401);
      const userClient = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setJWT(jwt);
      const user = await new Account(userClient).get();
      if (!user.status) return res.json({ error: "Account unavailable" }, 403);
      if (req.path === "/status") return res.json(await service.status(user.$id));
      if (req.path === "/challenge") return res.json(await service.challenge(user.$id));
      await service.disconnect(user.$id);
      return res.json(await service.status(user.$id));
    }
    if (req.path !== "/inbound") return res.json({ error: "Not found" }, 404);
    if (req.method !== "POST") return res.text("Method not allowed", 405);
    if (req.queryString || !req.headers["content-type"]?.toLowerCase().startsWith("application/x-www-form-urlencoded")) return res.text("Invalid request", 415);
    const { message, params } = parseInbound(req.bodyText, req.headers["x-twilio-signature"], config);
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
    return res.text(notice ? `<Response><Message>${xml(notice)}</Message></Response>` : "<Response/>", 200, { "content-type": "text/xml" });
  } catch (cause) {
    // No phone numbers, note content, tokens, raw requests, or credentials in logs.
    const accountRequest = ["/status", "/challenge", "/disconnect"].includes(req.path);
    // Backend permission failures are retryable webhook failures. Only user
    // session failures on account endpoints should become HTTP 401/403.
    const status = cause instanceof SmsError ? cause.status : accountRequest && cause instanceof AppwriteException && [401, 403].includes(cause.code) ? cause.code : 503;
    error(`SMS request failed (${status}; ${cause instanceof AppwriteException ? cause.type : "request"})`);
    return res.json({ error: status === 503 ? "Temporarily unavailable" : "Request rejected" }, status);
  }
}
