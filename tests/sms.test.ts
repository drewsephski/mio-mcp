import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { Account, AppwriteException, TablesDB } from "node-appwrite";
import { captureText, connectionCode, optOut, parseInbound, payloadHash } from "../functions/mio-sms/src/inbound.ts";
import main from "../functions/mio-sms/src/main.ts";

const config = { accountSid: `AC${"a".repeat(32)}`, authToken: "test-secret", phone: "+12242866565", webhookUrl: "https://mio.example/inbound" };
const params = { AccountSid: config.accountSid, MessageSid: `SM${"b".repeat(32)}`, From: "+12243431711", To: config.phone, Body: "Need to add streaming responses to LaunchStack tomorrow", NumMedia: "0" };
function signature(values: Record<string, string>, url = config.webhookUrl) {
  return createHmac("sha1", config.authToken).update(url + Object.keys(values).sort().map(key => key + values[key]).join("")).digest("base64");
}
const body = (values: Record<string, string>) => new URLSearchParams(values).toString();

test("Twilio validation includes unknown parameters and the canonical external URL", () => {
  const values = { ...params, FutureTwilioField: "new value", Body: "An idea 🦑 + more" };
  assert.equal(parseInbound(body(values), signature(values), config).message.Body, values.Body);
  assert.throws(() => parseInbound(body({ ...values, Body: "tampered" }), signature(values), config), /signature/);
  assert.throws(() => parseInbound(body(values), signature(values, "https://attacker.example/inbound"), config), /signature/);
  assert.throws(() => parseInbound(body(values), "", config), /signature/);
});
test("signed requests still reject wrong accounts, destination, invalid sender, and oversized bodies", () => {
  for (const values of [{ ...params, AccountSid: `AC${"c".repeat(32)}` }, { ...params, To: "+12242866566" }, { ...params, From: "attacker" }, { ...params, Body: "a".repeat(1601) }]) {
    assert.throws(() => parseInbound(body(values), signature(values), config));
  }
  assert.throws(() => parseInbound("a".repeat(32_769), "", config), /large/);
  assert.throws(() => parseInbound(`${body(params)}&From=%2B12240000000`, signature(params), config), /Duplicate/);
});
test("capture derives a concise title and keeps the complete original text", () => {
  const message = parseInbound(body(params), signature(params), config).message;
  const capture = captureText(message)!;
  assert.equal(capture.title, "Add streaming responses to LaunchStack tomorrow");
  assert.equal(capture.body, params.Body);
  assert.equal(capture.reply, "Saved to Inbox: “Add streaming responses to LaunchStack tomorrow”");
  assert.equal(captureText({ ...message, Body: "  " }), null);
  const long = captureText({ ...message, Body: "x".repeat(1600) })!;
  assert.equal(long.title.length, 255);
  assert.ok(long.reply.length < 140);
  const reminder = captureText({ ...message, Body: "remind me tomorrow at 10 to finish integration" })!;
  assert.match(reminder.reply, /aren't scheduled/);
  for (const text of ["Reminder to check a project before work today at 4", "Please remind me tomorrow to check the build"]) {
    assert.match(captureText({ ...message, Body: text })!.reply, /aren't scheduled/);
  }
  assert.match(captureText({ ...message, NumMedia: 1 })!.reply, /add attachments in Mio/);
});
test("message fingerprints detect changed payloads under the same SID", () => {
  const message = parseInbound(body(params), signature(params), config).message;
  assert.equal(payloadHash(message), payloadHash({ ...message }));
  for (const other of [{ ...message, Body: "changed" }, { ...message, From: "+12240000000" }, { ...message, NumMedia: 1 }]) assert.notEqual(payloadHash(message), payloadHash(other));
});
test("connection tokens and opt-out controls have strict, forgiving boundaries", () => {
  const code = "ab".repeat(16);
  assert.equal(connectionCode(` CONNECT ${code.toUpperCase()} `), code);
  assert.equal(connectionCode(`note connect ${code}`), undefined);
  assert.equal(connectionCode("connect ab12"), undefined);
  assert.equal(optOut(" Stop "), "stop");
  assert.equal(optOut("please stop working late"), null);
  assert.equal(optOut("anything", "STOP"), "stop");
  assert.equal(optOut("UNSTOP"), "start");
});

test("webhook backend authorization failures are retryable; invalid signatures and sessions are rejected", async (context) => {
  const variables = {
    APPWRITE_FUNCTION_API_ENDPOINT: "https://appwrite.example/v1", APPWRITE_FUNCTION_PROJECT_ID: "mio",
    APPWRITE_SMS_PROVIDER_ID: "provider", TWILIO_ACCOUNT_SID: config.accountSid,
    TWILIO_AUTH_TOKEN: config.authToken, MIO_PHONE_NUMBER: config.phone, TWILIO_WEBHOOK_URL: config.webhookUrl,
  };
  const previous = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
  Object.assign(process.env, variables);
  const unavailable = async () => { throw new AppwriteException("Scope unavailable", 401, "general_unauthorized_scope"); };
  const getRow = context.mock.method(TablesDB.prototype, "getRow", unavailable);
  context.mock.method(Account.prototype, "get", unavailable);
  const invoke = async (path: string, sig: string) => {
    let status = 0;
    await main({
      req: { method: path === "/status" ? "GET" : "POST", path, queryString: "", bodyText: body(params),
        headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig,
          "x-appwrite-key": "test-key", "x-appwrite-user-jwt": "test-jwt" } },
      res: { json: (_, code = 200) => { status = code; }, text: (_, code = 200) => { status = code; } },
      error: () => {},
    });
    return status;
  };
  try {
    assert.equal(await invoke("/inbound", "invalid"), 403);
    assert.equal(getRow.mock.callCount(), 0);
    assert.equal(await invoke("/inbound", signature(params)), 503);
    assert.equal(await invoke("/status", signature(params)), 401);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
