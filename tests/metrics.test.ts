import assert from "node:assert/strict";
import { test } from "node:test";
import { betaMetrics, type MetricInput } from "../functions/mio-sms/src/metrics.ts";
import { defaultUsageLimits } from "../functions/mio-sms/src/usage.ts";
import { isOperator } from "../functions/mio-sms/src/operator-auth.ts";
import { validOperationsToken } from "../functions/mio-sms/src/readiness.ts";
const date = (day: number) => `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`;
function fixture(): MetricInput { return { now: new Date(date(6)), limits: defaultUsageLimits,
  users: [{ $id: "a" }, { $id: "b" }], connections: [{ ownerId: "a", $createdAt: date(1) }, { ownerId: "b", $createdAt: date(1) }],
  turns: [{ ownerId: "a", $createdAt: date(2), outcomes: ["created_note"] }, { ownerId: "a", $createdAt: date(4), outcomes: ["clarification"] }, { ownerId: "a", $createdAt: date(6), outcomes: ["updated_reminder"] }, { ownerId: "a", $createdAt: date(6), outcomes: ["answered"] }, { ownerId: "b", $createdAt: date(6), outcomes: ["failed"] }, { ownerId: "outsider", $createdAt: date(6), outcomes: ["created_note"] }],
  reminders: [{ ownerId: "a", $createdAt: date(3), status: "sent", revision: 1, syncPending: false, lastError: "" }, { ownerId: "b", $createdAt: date(4), status: "failed", revision: 1, syncPending: true, lastError: "messaging_unavailable" }],
  jobs: [{ ownerId: "a", $createdAt: date(2), $updatedAt: date(2), status: "done", attempts: 1, nextAttemptAt: date(2) }, { ownerId: "b", $createdAt: date(6), $updatedAt: date(6), status: "failed", attempts: 3, nextAttemptAt: date(6) }],
  daily: [{ ownerId: "a", date: "2026-10-06", inboundSms: 5, outboundSms: 20, aiTurns: 80, aiReservedMicros: 1, smsReservedMicros: 1 }], visits: [{ ownerId: "a", date: "2026-10-06", surface: "web" }, { ownerId: "a", date: "2026-10-05", surface: "web" }],
}; }
test("operator identity is exact, verified and active; normal users are denied", () => {
  const user = { $id: "operator", status: true, emailVerification: true };
  assert.equal(isOperator(user, "operator"), true);
  assert.equal(isOperator({ ...user, $id: "normal" }, "operator"), false);
  assert.equal(isOperator(user, undefined), false);
  assert.equal(isOperator({ ...user, emailVerification: false }, "operator"), false);
  assert.equal(isOperator({ ...user, status: false }, "operator"), false);
});
test("operations endpoints fail closed for absent or wrong tokens", () => {
  const secret = "a".repeat(32);
  assert.equal(validOperationsToken(secret, secret), true);
  assert.equal(validOperationsToken(undefined, secret), false);
  assert.equal(validOperationsToken("b".repeat(32), secret), false);
  assert.equal(validOperationsToken(secret, "short"), false);
});
test("aggregate metrics deduplicate days/users and exclude unadmitted accounts", () => {
  const result = betaMetrics(fixture());
  assert.equal(result.admittedUsers, 2); assert.equal(result.activeThreeDays, 1); assert.equal(result.activeToday, 2);
  assert.equal(result.smsTurnsToday, 3); assert.equal(result.smsTurnsSevenDays, 5); assert.equal(result.connectedActivation.rate, .5);
  assert.equal(result.clarification.numerator, 1); assert.equal(result.failedAssistantTurns.rate, .5);
  assert.equal(result.reminderSchedulingFailures.rate, .5); assert.equal(result.companionVisitorsSevenDays, 1);
  assert.equal(result.usersNearLimits, 1); assert.equal(result.users[0].firstSuccessfulReminder, date(3));
});
test("empty and historical data are not reported as invented outcome classifications", () => {
  const input = fixture(); input.turns = [{ ownerId: "a", $createdAt: date(6), outcomes: [] }]; input.jobs = [];
  const result = betaMetrics(input);
  assert.equal(result.unknownOutcomeTurns, 1); assert.equal(result.clarification.rate, null); assert.equal(result.failedAssistantTurns.rate, null);
});
