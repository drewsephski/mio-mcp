import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Account, TablesDB, Users } from "node-appwrite";
import { MockLanguageModelV3 } from "ai/test";
import twilio from "twilio";
import { createAgent, type AgentRunner } from "../src/agent.ts";
import { digest, SmsError } from "../src/inbound.ts";
import main from "../src/main.ts";
import { createSmsService } from "../src/service.ts";
import { scheduledMessageId } from "../src/tools.ts";
import { createUsageControls, type UsageLimits, UsageLimitError } from "../src/usage.ts";
import { backend } from "./backend.ts";

type Action = string | { name: string; input: Record<string, unknown> };
const action = (name: string, input: Record<string, unknown>): Action => ({ name, input });
function fixture(context: TestContext, options: { limits?: Partial<UsageLimits>; invitedEmails?: string[] } = {}) {
  const db = backend(context);
  let clock = new Date("2026-10-06T17:00:00Z"), sequence = 0, turns = 0, modelSteps = 0;
  let script: Action[] = [], email = "owner@example.com", emailVerification = true;
  context.mock.method(db.users, "get", async ({ userId }: { userId: string }) => ({ $id: userId, email, emailVerification, status: true, prefs: {} }));
  const target = context.mock.method(db.users, "createTarget", async ({ targetId }: { targetId: string }) => ({ $id: targetId }));
  const model = new MockLanguageModelV3({ doGenerate: async () => {
    const step = script.shift(); modelSteps++;
    if (!step) throw new Error("No mocked model step");
    return { content: typeof step === "string" ? [{ type: "text" as const, text: step }] : [{ type: "tool-call" as const, toolCallId: `tool${modelSteps}`, toolName: step.name, input: JSON.stringify(step.input) }],
      finishReason: { unified: typeof step === "string" ? "stop" as const : "tool-calls" as const, raw: undefined },
      usage: { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } }, warnings: [] };
  } });
  const luna = createAgent({ languageModel: model });
  const agent: AgentRunner = async input => { turns++; return luna(input); };
  const usage = createUsageControls(db.tables, { databaseId: "mio", limits: options.limits, now: () => clock });
  const config = { databaseId: "mio", providerId: "provider", phone: "+15550000002", now: () => clock, agent, usage,
    invitedEmails: options.invitedEmails ?? ["owner@example.com"] };
  const service = createSmsService(db.tables, db.users, db.messaging, config);
  const message = (body: string) => ({ AccountSid: `AC${"a".repeat(32)}`, MessageSid: `SM${(++sequence).toString(16).padStart(32, "0")}`,
    From: "+15550000001", To: config.phone, Body: body, NumMedia: 0 });
  return { ...db, service, usage, target, model, message, turns: () => turns, setEmail: (value: string) => { email = value; }, setVerified: (value: boolean) => { emailVerification = value; },
    setScript: (steps: Action[]) => { script = [...steps]; }, advance: (ms: number) => { clock = new Date(clock.getTime() + ms); },
    async turn(body: string, steps: Action[]) { script = [...steps]; const sms = message(body); await service.inbound(sms); await service.work("owner"); return sms; },
  };
}
const rejected = (status: number) => (error: unknown) => error instanceof SmsError && error.status === status;

test("pairing audits consent, consumes the token once and rejects old or unconsented codes", async context => {
  const f = fixture(context);
  await f.service.disconnect("owner");
  await assert.rejects(f.service.challenge("owner", "old"), rejected(400));
  const old = await f.service.challenge("owner", "2026-10-06");
  const fresh = await f.service.challenge("owner", "2026-10-06");
  const expired = await f.service.inbound(f.message(`CONNECT ${old.code}`));
  assert.ok("notice" in expired && /expired|replaced/i.test(expired.notice));
  assert.equal(f.target.mock.callCount(), 0);
  assert.equal(f.rowsIn("sms_connections").length, 0);
  const challenge = f.rows.get("sms_challenges:owner")!;
  assert.equal(challenge.consentVersion, "2026-10-06");
  assert.ok(typeof challenge.consentedAt === "string");
  assert.notEqual(challenge.tokenHash, fresh.code);
  const paired = f.message(`CONNECT ${fresh.code}`);
  await f.service.inbound(paired);
  const binding = f.rows.get("sms_connections:owner")!;
  assert.equal(binding.consentVersion, "2026-10-06");
  assert.equal(binding.consentedAt, challenge.consentedAt);
  assert.equal(f.rowsIn("sms_challenges").length, 0);
  await f.service.inbound(paired);
  assert.equal(f.target.mock.callCount(), 1);
  assert.equal(f.rowsIn("sms_connections").length, 1);
  assert.equal(f.messages.size, 1);
});

test("old challenges without consent never create a Messaging target or binding", async context => {
  const f = fixture(context);
  await f.service.disconnect("owner");
  const code = "a".repeat(32);
  f.seed("sms_challenges", "owner", { tokenHash: digest(code), expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const result = await f.service.inbound(f.message(`CONNECT ${code}`));
  assert.ok("notice" in result && /terms/i.test(result.notice));
  assert.equal(f.target.mock.callCount(), 0);
  assert.equal(f.rowsIn("sms_connections").length, 0);
});

test("invite removal blocks new consent challenges and previously issued pairing tokens", async context => {
  const f = fixture(context);
  await f.service.disconnect("owner");
  const challenge = await f.service.challenge("owner", "2026-10-06");
  f.setEmail("uninvited@example.com");
  await assert.rejects(f.service.challenge("owner", "2026-10-06"), rejected(403));
  await assert.rejects(f.service.inbound(f.message(`CONNECT ${challenge.code}`)), rejected(403));
  assert.equal(f.target.mock.callCount(), 0);
  assert.equal(f.rowsIn("sms_connections").length, 0);
});

test("an unverified invited address cannot obtain a pairing token or use a previously issued token", async context => {
  const f = fixture(context);
  await f.service.disconnect("owner");
  f.setVerified(false);
  await assert.rejects(f.service.challenge("owner", "2026-10-06"), rejected(403));
  assert.equal(f.rowsIn("sms_challenges").length, 0);
  f.setVerified(true);
  const challenge = await f.service.challenge("owner", "2026-10-06");
  f.setVerified(false);
  await assert.rejects(f.service.inbound(f.message(`CONNECT ${challenge.code}`)), rejected(403));
  assert.equal(f.target.mock.callCount(), 0);
  assert.equal(f.rowsIn("sms_connections").length, 0);
});

test("loss of email verification revokes queued AI work and suppresses pending private replies", async context => {
  const f = fixture(context);
  await f.service.inbound(f.message("Remember this"));
  f.seed("sms_receipts", "pending_reply", { ownerId: "owner", phone: "+15550000001", targetId: "target", payloadHash: "hash", reply: "Private response", replyQueued: false, reminderIds: [], deliveryMode: "live" });
  f.setVerified(false);
  await f.service.inbound(f.message("Another thought"));
  await f.service.work("owner");
  assert.equal(f.rowsIn("sms_jobs").length, 1);
  assert.equal(f.rowsIn("sms_jobs")[0].status, "revoked");
  assert.equal(f.turns(), 0);
  assert.equal(f.messages.size, 0);
  assert.equal(f.rows.get("sms_receipts:pending_reply")!.replyQueued, true);
});

test("the full SMS loop reserves inbound, AI and outbound once and reports observed tokens", async context => {
  const f = fixture(context);
  const sms = await f.turn("Remember the launch", [action("createNote", { title: "Launch", body: "Remember the launch" }), "Saved the launch."]);
  const daily = await f.usage.daily("owner");
  assert.equal(daily.inboundSms, 1);
  assert.equal(daily.aiTurns, 1);
  assert.equal(daily.outboundSms, 1);
  assert.equal(daily.inputTokens, 6);
  assert.equal(daily.outputTokens, 4);
  assert.equal(f.rowsIn("notes").length, 1);
  assert.equal(f.messages.size, 1);
  await f.service.inbound(sms);
  await f.service.work("owner");
  assert.deepEqual(await f.usage.daily("owner"), daily);
  assert.equal(f.turns(), 1);
});

test("inbound and AI limits prevent model work while retaining bounded durable jobs", async context => {
  const f = fixture(context, { limits: { inboundPerMinute: 1, aiPerHour: 0 } });
  const sms = f.message("Remember the launch");
  f.setScript(["Saved."]);
  await f.service.inbound(sms);
  await assert.rejects(f.service.inbound(f.message("Another thought")), UsageLimitError);
  await f.service.work("owner");
  assert.equal(f.turns(), 0);
  assert.equal(f.rowsIn("sms_jobs").length, 1);
  assert.equal(f.rowsIn("sms_receipts").length, 0);
  const job = f.rowsIn("sms_jobs")[0];
  assert.equal(job.attempts, 0);
  assert.equal(job.nextAttemptAt, "2026-10-06T18:00:00.000Z");
  assert.equal((await f.usage.daily("owner")).aiTurns, 0);
});

test("a depleted global AI budget stops the next conversational turn before any model or tool call", async context => {
  const f = fixture(context, { limits: { globalAiDailyMicros: 250_000 } });
  await f.turn("Remember the launch", [action("createNote", { title: "Launch", body: "Remember the launch" }), "Saved."]);
  await f.turn("Change that to tomorrow", [action("createNote", { title: "Incorrect second write", body: "This must never execute" }), "Updated."]);
  assert.equal(f.turns(), 1);
  assert.equal(f.rowsIn("notes").length, 1);
  assert.equal(f.rowsIn("sms_turns").length, 1);
  assert.equal(f.rowsIn("sms_jobs")[1].status, "queued");
  assert.equal(f.rowsIn("sms_jobs")[1].attempts, 0);
  const daily = await f.usage.daily("owner");
  assert.equal(daily.aiTurns, 1);
  assert.equal(daily.globalLimited.ai, true);
});

test("the outbound cap preserves committed memory but never sends an unreserved confirmation", async context => {
  const f = fixture(context, { limits: { outboundPerDay: 0 } });
  await f.turn("Remember the launch", [action("createNote", { title: "Launch", body: "Remember the launch" }), "Saved the launch."]);
  assert.equal(f.rowsIn("notes").length, 1);
  assert.equal(f.rowsIn("sms_receipts")[0].replyQueued, false);
  assert.equal(f.messages.size, 0);
  await f.service.retryReplies();
  assert.equal(f.turns(), 1);
  assert.equal(f.messages.size, 0);
  assert.equal((await f.usage.daily("owner")).outboundSms, 0);
});

test("SMS disabled preferences revoke queued jobs and queued private replies despite a surviving binding", async context => {
  const f = fixture(context);
  await f.service.inbound(f.message("Remember this"));
  f.seed("sms_receipts", "pending_reply", { ownerId: "owner", phone: "+15550000001", targetId: "target", payloadHash: "hash", reply: "Private response", replyQueued: false, reminderIds: [], deliveryMode: "live" });
  await f.tables.updateRow({ databaseId: "mio", tableId: "sms_conversations", rowId: "owner", data: { smsEnabled: false } });
  await f.service.work("owner");
  assert.equal(f.rowsIn("sms_jobs")[0].status, "revoked");
  assert.equal(f.turns(), 0);
  assert.equal(f.messages.size, 0);
  assert.equal(f.rows.get("sms_receipts:pending_reply")!.replyQueued, true);
});

test("disconnect recalls every native reminder rather than only the first reconciliation page", async context => {
  const f = fixture(context);
  for (let index = 0; index < 6; index++) {
    const reminderId = `r${index}`;
    f.seed("reminders", reminderId, { ownerId: "owner", noteId: "", eventAt: "2026-10-07T15:00:00Z", remindAt: "2026-10-07T14:45:00Z",
      timezone: "America/Chicago", message: "Reminder", status: "pending", revision: 1, messageId: scheduledMessageId(reminderId, 1),
      appliedMessageId: "", targetId: "target", syncPending: true, lastError: "" });
  }
  await f.service.work("owner");
  await f.service.work("owner");
  assert.equal(f.messages.size, 6);
  await f.service.disconnect("owner");
  assert.equal(f.messages.size, 0);
  assert.ok(f.rowsIn("reminders").every(row => row.status === "canceled" && row.syncPending === false));
});

test("native reminder caps apply to all tool calls within one transaction", async context => {
  const f = fixture(context, { limits: { maxActiveReminders: 10, maxScheduledOutbound: 1 } });
  const first = { eventLocal: "2026-10-07T10:00", offsetMinutes: 0, message: "First" };
  await f.turn("Remind me tomorrow", [action("createReminder", first), action("createReminder", { ...first, message: "Second" }), "I created the first reminder; cancel it before adding another."]);
  assert.equal(f.rowsIn("reminders").length, 1);
  assert.equal(f.rowsIn("reminders")[0].status, "scheduled");
  assert.equal(f.messages.size, 2);
  assert.match(JSON.stringify(f.model.doGenerateCalls.at(-1)?.prompt), /active reminder limit/i);
  assert.equal((await f.usage.daily("owner")).outboundSms, 2);
});

test("native reminder scheduling fails closed when the shared SMS budget has no reservation left", async context => {
  const f = fixture(context, { limits: { globalSmsDailyMicros: 500_000 } });
  await f.turn("Remind me tomorrow", [action("createReminder", { eventLocal: "2026-10-07T10:00", offsetMinutes: 0, message: "Check the launch" }), "I will remind you tomorrow at 10."]);
  assert.equal(f.turns(), 1);
  assert.equal(f.rowsIn("reminders").length, 1);
  assert.equal(f.rowsIn("reminders")[0].status, "pending");
  assert.equal(f.rowsIn("reminders")[0].syncPending, true);
  assert.equal(f.rowsIn("sms_receipts")[0].replyQueued, false);
  assert.equal(f.messages.size, 0);
  assert.equal((await f.usage.daily("owner")).globalLimited.sms, true);
  // The intent survives until the next UTC budget day, before its due time.
  f.advance(12 * 3600_000);
  await f.service.work("owner");
  assert.equal(f.rowsIn("reminders")[0].status, "scheduled");
  assert.equal(f.messages.size, 1);
  assert.equal(f.turns(), 1);
});

test("model reminder quiet-hour rejection is actionable and commits no schedule", async context => {
  const f = fixture(context);
  await f.service.companion.savePreferences("owner", { quietHoursStart: "22:00", quietHoursEnd: "07:00" });
  await f.turn("Remind me at 6 tomorrow", [action("createReminder", { eventLocal: "2026-10-07T06:00", offsetMinutes: 0, message: "Wake up" }), "That falls during your quiet hours. What other time would you like?"]);
  assert.equal(f.rowsIn("reminders").length, 0);
  assert.match(JSON.stringify(f.model.doGenerateCalls.at(-1)?.prompt), /quiet hours/i);
  assert.equal(f.messages.size, 1);
});

function httpFixture(context: TestContext) {
  const f = fixture(context);
  const variables = { APPWRITE_FUNCTION_API_ENDPOINT: "https://appwrite.example/v1", APPWRITE_FUNCTION_PROJECT_ID: "mio",
    APPWRITE_SMS_PROVIDER_ID: "provider", TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`, TWILIO_AUTH_TOKEN: "token", MIO_PHONE_NUMBER: "+15550000002",
    TWILIO_WEBHOOK_URL: "https://mio.example/inbound", MIO_INVITE_EMAILS: "owner@example.com" };
  const previous = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
  Object.assign(process.env, variables);
  context.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  context.mock.method(Account.prototype, "get", async () => ({ $id: "owner", email: "owner@example.com", emailVerification: true, status: true }));
  context.mock.method(Users.prototype, "get", f.users.get.bind(f.users));
  context.mock.method(TablesDB.prototype, "getRow", f.tables.getRow.bind(f.tables));
  context.mock.method(TablesDB.prototype, "upsertRow", f.tables.upsertRow.bind(f.tables));
  const invoke = async (path: string, method: string, bodyText = "", jwt = "jwt", queryString = "", headers: Record<string, string> = {}) => {
    let status = 0, body: unknown;
    await main({ req: { path, method, bodyText, queryString, headers: { "x-appwrite-key": "key", ...(jwt ? { "x-appwrite-user-jwt": jwt } : {}), ...headers } },
      res: { json: (data, code = 200) => { body = data; status = code; }, text: (data, code = 200) => { body = data; status = code; } }, error: () => {} });
    return { status, body };
  };
  return { ...f, invoke };
}

test("authenticated companion endpoints reject missing sessions, wrong methods and invalid consent", async context => {
  const f = httpFixture(context);
  for (const path of ["/reminders", "/activity", "/preferences", "/usage"]) assert.equal((await f.invoke(path, "GET", "", "")).status, 401);
  assert.equal((await f.invoke("/activity", "POST")).status, 405);
  for (const body of ["{}", '{"consent":false,"consentVersion":"2026-10-06"}', '{"consent":true,"consentVersion":"old"}', '{"consent":true,"consentVersion":"2026-10-06","ownerId":"other"}', "broken"]) {
    assert.equal((await f.invoke("/challenge", "POST", body)).status, 400);
  }
  assert.equal(f.rowsIn("sms_challenges").length, 0);
  assert.equal((await f.invoke("/preferences", "POST", "x".repeat(8193))).status, 413);
  await f.service.disconnect("owner");
  assert.equal((await f.invoke("/challenge", "POST", '{"consent":true,"consentVersion":"2026-10-06"}')).status, 200);
  assert.equal(f.rowsIn("sms_challenges").length, 1);
});

test("companion HTTP access is restricted to the authenticated invited account", async context => {
  const f = httpFixture(context);
  context.mock.method(Account.prototype, "get", async () => ({ $id: "other", email: "other@example.com", status: true }));
  for (const path of ["/reminders", "/activity", "/preferences", "/usage"]) assert.equal((await f.invoke(path, "GET")).status, 403);
  assert.equal((await f.invoke("/challenge", "POST", '{"consent":true,"consentVersion":"2026-10-06"}')).status, 403);
});

test("unverified invited sessions cannot call companion APIs, but can inspect their connection", async context => {
  const f = httpFixture(context);
  context.mock.method(Account.prototype, "get", async () => ({ $id: "owner", email: "owner@example.com", emailVerification: false, status: true }));
  for (const path of ["/reminders", "/activity", "/preferences", "/usage"]) assert.equal((await f.invoke(path, "GET")).status, 403);
  for (const path of ["/challenge", "/preferences", "/reminders/update", "/reminders/cancel"]) assert.equal((await f.invoke(path, "POST", '{}')).status, 403);
  assert.equal((await f.invoke("/status", "GET")).status, 200);
});

test("reconciliation update events cannot recursively invoke the scheduled reminder worker", async context => {
  const f = httpFixture(context);
  const scan = context.mock.method(TablesDB.prototype, "listRows", async () => { throw new Error("Unexpected worker scan"); });
  const result = await f.invoke("/", "POST", JSON.stringify({ ownerId: "owner", status: "scheduled", syncPending: false }), "", "",
    { "x-appwrite-trigger": "event", "x-appwrite-event": "tablesdb.mio.tables.reminders.rows.reminder.update" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ignored: true });
  assert.equal(scan.mock.callCount(), 0);
});

test("Twilio-owned HELP is acknowledged without a duplicate app message or usage reservation", async context => {
  const f = httpFixture(context);
  const scan = context.mock.method(TablesDB.prototype, "getRow", async () => { throw new Error("Unexpected control reservation"); });
  const params = { AccountSid: `AC${"a".repeat(32)}`, MessageSid: `SM${"b".repeat(32)}`, From: "+15550000001", To: "+15550000002", Body: "HELP", NumMedia: "0", OptOutType: "HELP" };
  const signature = twilio.getExpectedTwilioSignature("token", "https://mio.example/inbound", params);
  const result = await f.invoke("/inbound", "POST", new URLSearchParams(params).toString(), "", "",
    { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature });
  assert.equal(result.status, 200);
  assert.equal(result.body, "<Response/>");
  assert.equal(scan.mock.callCount(), 0);
  assert.equal(f.messages.size, 0);
  assert.equal(f.rowsIn("usage_events").length, 0);
});
