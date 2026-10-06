import { createHash } from "node:crypto";
import twilio from "twilio";
import { z } from "zod";

export class SmsError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

const inboundSchema = z.object({
  AccountSid: z.string().regex(/^AC[a-f0-9]{32}$/i),
  MessageSid: z.string().regex(/^(SM|MM)[a-f0-9]{32}$/i),
  From: z.string().regex(/^\+[1-9]\d{7,14}$/),
  To: z.string().regex(/^\+[1-9]\d{7,14}$/),
  Body: z.string().max(1600),
  NumMedia: z.coerce.number().int().min(0).max(10).default(0),
  OptOutType: z.string().optional(),
});

export type Inbound = z.infer<typeof inboundSchema>;
export type TwilioConfig = { accountSid: string; authToken: string; phone: string; webhookUrl: string };

export function parseInbound(body: string, signature: string, config: TwilioConfig) {
  if (Buffer.byteLength(body) > 32_768) throw new SmsError("Request too large", 413);
  const form = new URLSearchParams(body);
  const params: Record<string, string> = Object.create(null);
  for (const [key, value] of form) {
    if (key in params) throw new SmsError("Duplicate parameter");
    params[key] = value;
  }
  // Sign all parameters, including unknown future Twilio fields, against the
  // configured public URL. Proxy/Host headers never influence validation.
  if (!signature || !twilio.validateRequest(config.authToken, signature, config.webhookUrl, params)) {
    throw new SmsError("Invalid signature", 403);
  }
  const parsed = inboundSchema.safeParse(params);
  if (!parsed.success) throw new SmsError("Invalid SMS payload");
  if (parsed.data.AccountSid !== config.accountSid || parsed.data.To !== config.phone) {
    throw new SmsError("Wrong Twilio account or destination", 403);
  }
  return { message: parsed.data, params };
}

export function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function payloadHash(message: Inbound) {
  return digest(JSON.stringify([message.AccountSid, message.MessageSid, message.From, message.To, message.Body, message.NumMedia, message.OptOutType ?? ""]));
}
export function captureText(message: Inbound) {
  const body = message.Body.trim();
  if (!body) return null;
  const line = body.replace(/\s+/g, " ").replace(/^need to\s+/i, "");
  const title = (line.charAt(0).toUpperCase() + line.slice(1)).slice(0, 255);
  const preview = title.length > 100 ? `${title.slice(0, 99)}…` : title;
  const mediaNotice = message.NumMedia ? " Text saved; add attachments in Mio." : "";
  const reminderNotice = /^(?:(?:please\s+)?remind me\b|reminder\b)/i.test(body) ? " Reminders aren't scheduled yet." : "";
  return { title, body, reply: `Saved to Inbox: “${preview}”${mediaNotice}${reminderNotice}` };
}
export function connectionCode(body: string) { return /^connect\s+([a-f0-9]{32})$/i.exec(body.trim())?.[1].toLowerCase(); }
export function optOut(body: string, type?: string) {
  if (type?.toUpperCase() === "STOP" || /^(stop|stopall|unsubscribe|cancel|end|quit)$/i.test(body.trim())) return "stop";
  if (type?.toUpperCase() === "START" || /^(start|unstop)$/i.test(body.trim())) return "start";
  return null;
}
