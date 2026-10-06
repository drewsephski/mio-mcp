import assert from "node:assert/strict";
import test from "node:test";
import { AppwriteException } from "node-appwrite";
import { MockLanguageModelV3 } from "ai/test";
import { createAgent } from "../src/agent.ts";
import { backend } from "./backend.ts";
import { createUsageControls, defaultUsageLimits, UsageLimitError, usageLimitsFromEnv } from "../src/usage.ts";

const instant = new Date("2026-10-06T12:00:00Z");
const inbound = (operationId: string, ownerId = "owner") => ({ ownerId, operationId, kind: "inbound" as const });
const ai = (operationId: string, ownerId = "owner") => ({ ownerId, operationId, kind: "ai" as const });
const outbound = (operationId: string, ownerId = "owner") => ({ ownerId, operationId, kind: "outbound" as const });

test("usage environment rejects invalid numbers rather than bypassing limits", () => {
  assert.deepEqual(usageLimitsFromEnv({}), defaultUsageLimits);
  for (const value of ["", "NaN", "Infinity", "-1", "1.5", " 10", "1e3", "9007199254740992"]) {
    assert.throws(() => usageLimitsFromEnv({ MIO_MAX_AI_PER_DAY: value }), /Invalid usage limit/);
  }
  assert.throws(() => usageLimitsFromEnv({ MIO_AI_TURN_CEILING_MICROS: "0" }), /ceilings must be positive/);
  assert.equal(usageLimitsFromEnv({ MIO_MAX_AI_PER_DAY: "0" }).aiPerDay, 0);
});

test("same inbound identity reserves once and daily rows are owner-readable only", async context => {
  const f = backend(context), usage = createUsageControls(f.tables, { databaseId: "mio", now: () => instant });
  assert.equal((await usage.reserve(inbound("SM1"))).created, true);
  assert.equal((await usage.reserve(inbound("SM1"))).created, false);
  const daily = f.rowsIn("usage_daily")[0];
  assert.equal(daily.inboundSms, 1);
  assert.deepEqual(daily.$permissions, ['read("user:owner")']);
  assert.deepEqual(f.rowsIn("usage_events")[0].$permissions, []);
  assert.deepEqual(f.rowsIn("usage_global")[0].$permissions, []);
});

test("inbound per-minute cap rejects the seventh unique turn and resets at UTC boundary", async context => {
  const f = backend(context); let clock = instant;
  const usage = createUsageControls(f.tables, { databaseId: "mio", now: () => clock, limits: { inboundPerMinute: 2 } });
  await usage.reserve(inbound("SM1")); await usage.reserve(inbound("SM2"));
  await assert.rejects(usage.reserve(inbound("SM3")), error => error instanceof UsageLimitError && error.limit === "inboundPerMinute");
  assert.equal(f.rowsIn("usage_events").length, 2);
  clock = new Date(instant.getTime() + 60_000);
  assert.equal((await usage.reserve(inbound("SM3"))).created, true);
});

test("every AI retry consumes its own hourly and daily reservation", async context => {
  const f = backend(context); let clock = instant;
  const usage = createUsageControls(f.tables, { databaseId: "mio", now: () => clock, limits: { aiPerHour: 2, aiPerDay: 3 } });
  await usage.reserve(ai("SM1:attempt:1")); await usage.reserve(ai("SM1:attempt:2"));
  await assert.rejects(usage.reserve(ai("SM1:attempt:3")), error => error instanceof UsageLimitError && error.limit === "aiPerHour");
  clock = new Date(instant.getTime() + 3_600_000);
  await usage.reserve(ai("SM1:attempt:3"));
  await assert.rejects(usage.reserve(ai("SM2:attempt:1")), error => error instanceof UsageLimitError && error.limit === "aiPerDay");
  assert.equal(f.rowsIn("usage_daily")[0].aiTurns, 3);
  assert.equal(f.rowsIn("usage_daily")[0].aiReservedMicros, 3 * defaultUsageLimits.aiTurnCeilingMicros);
});

test("global AI budget is shared by every owner; failed attempts keep their cost ceiling", async context => {
  const f = backend(context), usage = createUsageControls(f.tables, { databaseId: "mio", now: () => instant,
    limits: { globalAiDailyMicros: defaultUsageLimits.aiTurnCeilingMicros } });
  await usage.reserve(ai("attempt1", "alice"));
  // No report or success event means an unknown provider result, not a refund.
  await assert.rejects(usage.reserve(ai("attempt1", "bob")), error => error instanceof UsageLimitError && error.limit === "globalAiDailyMicros");
  assert.equal(f.rowsIn("usage_daily").length, 1);
  assert.equal(f.rowsIn("usage_events").length, 1);
});

test("global SMS budget counts inbound and outbound and permits only previously reserved identities", async context => {
  const f = backend(context), usage = createUsageControls(f.tables, { databaseId: "mio", now: () => instant,
    limits: { globalSmsDailyMicros: 2 * defaultUsageLimits.smsMessageCeilingMicros } });
  await usage.reserve(inbound("SM1", "alice"));
  await usage.reserve(outbound("reminder1", "bob"));
  await assert.rejects(usage.reserve(outbound("reminder2", "alice")), error => error instanceof UsageLimitError && error.limit === "globalSmsDailyMicros");
  assert.equal((await usage.reserve(outbound("reminder1", "bob"))).created, false);
});

test("outbound user cap holds independently of global budget", async context => {
  const f = backend(context), usage = createUsageControls(f.tables, { databaseId: "mio", now: () => instant, limits: { outboundPerDay: 1 } });
  await usage.reserve(outbound("reply1"));
  await assert.rejects(usage.reserve(outbound("reminder1")), error => error instanceof UsageLimitError && error.limit === "outboundPerDay");
  await usage.reserve(outbound("reply2", "another-owner"));
});

test("concurrent owners cannot overspend the shared global bucket", async context => {
  const f = backend(context), usage = createUsageControls(f.tables, { databaseId: "mio", now: () => instant,
    limits: { globalAiDailyMicros: defaultUsageLimits.aiTurnCeilingMicros } });
  const outcomes = await Promise.allSettled([usage.reserve(ai("turn", "alice")), usage.reserve(ai("turn", "bob"))]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  assert.equal(f.rowsIn("usage_events").length, 1);
  assert.equal(f.rowsIn("usage_daily").reduce((sum, row) => sum + Number(row.aiTurns), 0), 1);
  const rejected = outcomes.find(outcome => outcome.status === "rejected");
  assert.ok(rejected?.status === "rejected" && rejected.reason instanceof AppwriteException && rejected.reason.code === 409);
});

test("concurrent duplicate operation creates one reservation and never authorizes AI replay", async context => {
  const f = backend(context), usage = createUsageControls(f.tables, { databaseId: "mio", now: () => instant });
  const outcomes = await Promise.all([usage.reserve(ai("SM1:attempt:1")), usage.reserve(ai("SM1:attempt:1"))]);
  assert.equal(outcomes.filter(outcome => outcome.created).length, 1);
  assert.equal(f.rowsIn("usage_daily")[0].aiTurns, 1);
});

test("lost commit response is inspected and returns no authorization to execute again", async context => {
  const f = backend(context), commit = f.tables.updateTransaction.bind(f.tables);
  let loseResponse = true;
  context.mock.method(f.tables, "updateTransaction", async (args: { transactionId: string; commit?: boolean; rollback?: boolean }) => {
    const result = await commit(args);
    if (args.commit && loseResponse) { loseResponse = false; throw new Error("lost response"); }
    return result;
  });
  const usage = createUsageControls(f.tables, { databaseId: "mio", now: () => instant });
  assert.equal((await usage.reserve(ai("SM1:attempt:1"))).created, false);
  assert.equal(f.rowsIn("usage_daily")[0].aiTurns, 1);
  assert.equal((await usage.reserve(ai("SM1:attempt:1"))).created, false);
});

test("observed usage is counted once even after reporting retries", async context => {
  const f = backend(context), usage = createUsageControls(f.tables, { databaseId: "mio", now: () => instant });
  const reservation = await usage.reserve(ai("SM1:attempt:1"));
  await usage.reportUsage(reservation.reservationId, { inputTokens: 1000, outputTokens: 40 });
  await usage.reportUsage(reservation.reservationId, { inputTokens: 1000, outputTokens: 40 });
  assert.equal(f.rowsIn("usage_daily")[0].inputTokens, 1000);
  assert.equal(f.rowsIn("usage_daily")[0].outputTokens, 40);
  assert.equal(f.rowsIn("usage_daily")[0].aiReservedMicros, defaultUsageLimits.aiTurnCeilingMicros);
  await assert.rejects(usage.reportUsage(reservation.reservationId, { inputTokens: NaN, outputTokens: 0 }), /Invalid observed/);
});

test("daily counters reset while operation identity remains permanently idempotent", async context => {
  const f = backend(context); let clock = instant;
  const usage = createUsageControls(f.tables, { databaseId: "mio", now: () => clock, limits: { aiPerDay: 1 } });
  await usage.reserve(ai("turn1"));
  clock = new Date(instant.getTime() + 86_400_000);
  assert.equal((await usage.reserve(ai("turn1"))).created, false);
  await usage.reserve(ai("turn2"));
  assert.equal(f.rowsIn("usage_daily").length, 2);
});

test("unavailable reservation storage fails closed", async context => {
  const f = backend(context);
  context.mock.method(f.tables, "createTransaction", async () => { throw new Error("database unavailable"); });
  const usage = createUsageControls(f.tables, { databaseId: "mio", now: () => instant });
  await assert.rejects(usage.reserve(ai("turn1")), /database unavailable/);
  assert.equal(f.rowsIn("usage_events").length, 0);
});

test("agent awaits observed token reporting even when its reply is rejected", async context => {
  const f = backend(context), usage = createUsageControls(f.tables, { databaseId: "mio", now: () => instant });
  const reservation = await usage.reserve(ai("bad-reply:attempt:1"));
  const model = new MockLanguageModelV3({ doGenerate: async () => ({
    content: [{ type: "text", text: "a".repeat(701) }], finishReason: { unified: "stop", raw: undefined },
    usage: { inputTokens: { total: 500, noCache: 500, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 200, text: 200, reasoning: 0 } }, warnings: [],
  }) });
  const agent = createAgent({ languageModel: model });
  await assert.rejects(agent({ text: "Hello", timezone: "America/Chicago", now: instant, defaultOffsetMinutes: 15,
    history: [], tools: {}, signal: AbortSignal.timeout(5000), observeUsage: metrics => usage.reportUsage(reservation.reservationId, metrics) }), /Invalid assistant reply/);
  assert.equal(f.rowsIn("usage_daily")[0].inputTokens, 500);
  assert.equal(f.rowsIn("usage_daily")[0].outputTokens, 200);
});

test("usage daily summary excludes other owners and exposes no internal identities or global totals", async context => {
  const f = backend(context), usage = createUsageControls(f.tables, { databaseId: "mio", now: () => instant,
    limits: { globalAiDailyMicros: defaultUsageLimits.aiTurnCeilingMicros } });
  await usage.reserve(inbound("SM1", "alice"));
  await usage.reserve(ai("SM2:attempt:1", "bob"));
  const summary = await usage.daily("alice");
  assert.equal(summary.inboundSms, 1); assert.equal(summary.aiTurns, 0);
  assert.equal(summary.globalLimited.ai, true);
  assert.equal(summary.globalLimited.sms, false);
  assert.equal(summary.date, "2026-10-06");
  assert.equal(summary.limits.aiPerDay, defaultUsageLimits.aiPerDay);
  assert.equal("ownerId" in summary, false); assert.equal("$id" in summary, false);
  assert.equal("globalAiReservedMicros" in summary, false);
  assert.equal((await usage.daily("new-owner")).inboundSms, 0);
});
