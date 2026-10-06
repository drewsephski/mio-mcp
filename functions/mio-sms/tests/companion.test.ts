import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createAssistant } from "../src/assistant.ts";
import { createCompanionService } from "../src/companion.ts";
import { SmsError } from "../src/inbound.ts";
import { scheduledMessageId } from "../src/tools.ts";
import { backend } from "./backend.ts";

function fixture(context: TestContext) {
  const db = backend(context);
  const config = { databaseId: "mio", now: () => new Date("2026-10-06T17:00:00Z"), agent: async () => "Saved." };
  const assistant = createAssistant(db.tables, db.users, db.messaging, config);
  let disconnected = false;
  const companion = createCompanionService(db.tables, db.users, assistant, config, { disconnect: async ownerId => {
    disconnected = true;
    await db.tables.deleteRow({ databaseId: "mio", tableId: "sms_connections", rowId: ownerId });
  } });
  function reminder(rowId = "reminder", ownerId = "owner", fields: Record<string, unknown> = {}) {
    return db.seed("reminders", rowId, { ownerId, noteId: "", eventAt: "2026-10-07T15:00:00Z", remindAt: "2026-10-07T14:45:00Z",
      timezone: "America/Chicago", message: "Check your application", status: "pending", revision: 1,
      messageId: scheduledMessageId(rowId, 1), appliedMessageId: "", targetId: "target", syncPending: true, lastError: "", ...fields });
  }
  return { ...db, companion, assistant, reminder, disconnected: () => disconnected };
}
const rejected = (status: number) => (error: unknown) => error instanceof SmsError && error.status === status;

test("reminder lists are owner scoped, bounded and exclude internal routing fields", async context => {
  const f = fixture(context);
  for (let index = 0; index < 27; index++) f.reminder(`r${String(index).padStart(2, "0")}`);
  f.reminder("private", "other", { message: "Private" });
  f.reminder("sent", "owner", { status: "sent" });
  const first = await f.companion.reminders("owner");
  assert.equal(first.items.length, 25);
  assert.equal(first.nextCursor, "r24");
  assert.ok(first.items.every(row => !("targetId" in row) && !("ownerId" in row) && !("messageId" in row)));
  const second = await f.companion.reminders("owner", { cursor: first.nextCursor });
  assert.deepEqual(second.items.map(row => row.id), ["r25", "r26"]);
  assert.equal(second.nextCursor, null);
  assert.deepEqual((await f.companion.reminders("owner", { view: "history" })).items.map(row => row.id), ["sent"]);
  await assert.rejects(f.companion.reminders("owner", { cursor: "private" }), rejected(404));
  await assert.rejects(f.companion.reminders("owner", { view: "all" }), rejected(400));
});

test("activity is a factual transcript with only currently owned note references", async context => {
  const f = fixture(context);
  f.seed("notes", "own", { ownerId: "owner", title: "Application" });
  f.seed("notes", "foreign", { ownerId: "other", title: "Private" });
  f.seed("sms_turns", "turn", { ownerId: "owner", userText: "Remember my application", reply: "Saved.", noteIds: ["own", "foreign", "deleted"], reminderIds: [] });
  f.seed("sms_turns", "foreign_turn", { ownerId: "other", userText: "Private", reply: "Private", noteIds: [], reminderIds: [] });
  const page = await f.companion.activity("owner");
  assert.equal(page.items.length, 1);
  assert.deepEqual(page.items[0].notes, [{ id: "own", title: "Application" }]);
  assert.equal(page.items[0].userText, "Remember my application");
  assert.equal(page.items[0].reply, "Saved.");
  assert.ok(!("actions" in page.items[0]));
  await assert.rejects(f.companion.activity("owner", { cursor: "foreign_turn" }), rejected(404));
});

test("web reminder editing reconciles the same durable intent and recalls the previous schedule", async context => {
  const f = fixture(context);
  f.reminder();
  await f.assistant.reconcileReminders("owner");
  const oldId = scheduledMessageId("reminder", 1);
  assert.equal(f.messages.get(oldId)?.status, "scheduled");
  const result = await f.companion.updateReminder("owner", { id: "reminder", revision: 1, eventLocal: "2026-10-07T10:30", message: "Updated application reminder" });
  assert.equal(result.eventAt, "2026-10-07T15:30:00Z");
  assert.equal(result.remindAt, "2026-10-07T15:15:00Z");
  assert.equal(result.revision, 2);
  assert.equal(result.status, "scheduled");
  assert.equal(result.syncPending, false);
  assert.ok(f.deletedMessages.includes(oldId));
  assert.equal(f.messages.get(scheduledMessageId("reminder", 2))?.scheduledAt, result.remindAt);
});

test("canceling recalls the native schedule and makes stale revisions conflict", async context => {
  const f = fixture(context);
  f.reminder();
  await f.assistant.reconcileReminders("owner");
  const result = await f.companion.cancelReminder("owner", { id: "reminder", revision: 1 });
  assert.equal(result.status, "canceled");
  assert.equal(result.revision, 2);
  assert.equal(result.syncPending, false);
  assert.ok(!f.messages.has(scheduledMessageId("reminder", 1)));
  await assert.rejects(f.companion.updateReminder("owner", { id: "reminder", revision: 1, eventLocal: "2026-10-07T11:00" }), rejected(409));
});

test("foreign reminders, disabled accounts and near-due reminders cannot be mutated", async context => {
  const f = fixture(context);
  f.reminder("foreign", "other");
  f.reminder("due", "owner", { remindAt: "2026-10-06T17:00:30Z" });
  await assert.rejects(f.companion.cancelReminder("owner", { id: "foreign", revision: 1 }), rejected(404));
  await assert.rejects(f.companion.cancelReminder("owner", { id: "due", revision: 1 }), rejected(409));
  assert.equal(f.rows.get("reminders:foreign")!.status, "pending");
  assert.equal(f.rows.get("reminders:due")!.status, "pending");
  context.mock.method(f.users, "get", async () => ({ status: false }));
  await assert.rejects(f.companion.cancelReminder("owner", { id: "due", revision: 1 }), rejected(403));
});

test("invalid timestamps, ambiguous DST, nonexistent DST and past times do not revise intent", async context => {
  const f = fixture(context);
  f.reminder();
  for (const eventLocal of ["invalid", "2026-11-01T01:30", "2027-03-14T02:30", "2026-10-06T11:00", "2026-10-40T10:00"]) {
    await assert.rejects(f.companion.updateReminder("owner", { id: "reminder", revision: 1, eventLocal }), rejected(400));
    assert.equal(f.rows.get("reminders:reminder")!.revision, 1);
  }
  await assert.rejects(f.companion.updateReminder("owner", { id: "reminder", revision: 1, eventLocal: "2026-10-07T10:00", timezone: "+05:00" }), rejected(400));
  await assert.rejects(f.companion.updateReminder("owner", { id: "reminder", revision: 1, eventLocal: "2026-10-07T10:00", ownerId: "other" }), rejected(400));
});

test("concurrent edits share the conversational lease and only one revision commits", async context => {
  const f = fixture(context);
  f.reminder();
  const results = await Promise.allSettled([
    f.companion.updateReminder("owner", { id: "reminder", revision: 1, eventLocal: "2026-10-07T10:30" }),
    f.companion.cancelReminder("owner", { id: "reminder", revision: 1 }),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.rows.get("reminders:reminder")!.revision, 2);
  const failed = results.find(result => result.status === "rejected");
  assert.ok(failed?.status === "rejected" && rejected(409)(failed.reason));
});

test("a lost commit acknowledgement inspects intent instead of duplicating a reminder revision", async context => {
  const f = fixture(context);
  f.reminder();
  const commit = f.tables.updateTransaction.bind(f.tables);
  let commits = 0;
  context.mock.method(f.tables, "updateTransaction", async (input: { transactionId: string; commit?: boolean; rollback?: boolean }) => {
    const result = await commit(input);
    if (input.commit && ++commits === 2) throw new Error("Lost commit acknowledgement");
    return result;
  });
  const updated = await f.companion.updateReminder("owner", { id: "reminder", revision: 1, eventLocal: "2026-10-07T10:30" });
  assert.equal(updated.revision, 2);
  assert.equal(updated.status, "scheduled");
  assert.equal(f.rowsIn("reminders").length, 1);
  assert.equal(f.messages.size, 1);
});

test("Messaging outage preserves visible pending intent for the durable worker", async context => {
  const f = fixture(context);
  f.reminder();
  f.failMessages(true);
  const result = await f.companion.updateReminder("owner", { id: "reminder", revision: 1, eventLocal: "2026-10-07T10:30" });
  assert.equal(result.revision, 2);
  assert.equal(result.syncPending, true);
  assert.equal(result.status, "pending");
  f.failMessages(false);
  await f.assistant.reconcileReminders("owner");
  assert.equal(f.rows.get("reminders:reminder")!.status, "scheduled");
});

test("a worker whose lease is replaced cannot stage a web reminder mutation", async context => {
  const f = fixture(context);
  f.reminder();
  const acquire = f.assistant.acquire.bind(f.assistant);
  context.mock.method(f.assistant, "acquire", async (ownerId: string) => {
    const token = await acquire(ownerId);
    await f.tables.updateRow({ databaseId: "mio", tableId: "sms_conversations", rowId: ownerId, data: { leaseToken: "replacement" } });
    return token;
  });
  await assert.rejects(f.companion.cancelReminder("owner", { id: "reminder", revision: 1 }), /lease expired/i);
  assert.equal(f.rows.get("reminders:reminder")!.revision, 1);
  assert.equal(f.rows.get("reminders:reminder")!.status, "pending");
  assert.equal(f.messages.size, 0);
});

test("disconnect racing a web edit conflicts with its transaction instead of scheduling SMS", async context => {
  const f = fixture(context);
  f.reminder();
  const update = f.tables.updateRow.bind(f.tables);
  context.mock.method(f.tables, "updateRow", async (input: { databaseId: string; tableId: string; rowId: string; data?: Record<string, unknown>; transactionId?: string }) => {
    const result = await update(input);
    if (input.tableId === "reminders" && input.transactionId) {
      await f.tables.deleteRow({ databaseId: "mio", tableId: "sms_connections", rowId: "owner" });
    }
    return result;
  });
  await assert.rejects(f.companion.updateReminder("owner", { id: "reminder", revision: 1, eventLocal: "2026-10-07T10:30" }));
  assert.equal(f.rows.get("reminders:reminder")!.revision, 1);
  assert.equal(f.messages.size, 0);
});

test("preferences use assistant context and reject unsupported opt-ins and invalid quiet hours", async context => {
  const f = fixture(context);
  const saved = await f.companion.savePreferences("owner", { timezone: "America/New_York", defaultOffsetMinutes: 30, quietHoursStart: "22:00", quietHoursEnd: "07:00" });
  assert.equal(saved.timezone, "America/New_York");
  assert.equal(saved.defaultOffsetMinutes, 30);
  assert.equal(saved.quietHoursStart, "22:00");
  assert.equal(saved.smsEnabled, true);
  const contextRow = f.rows.get("sms_conversations:owner")!;
  assert.equal(contextRow.timezone, "America/New_York");
  for (const invalid of [{ proactiveMessagesEnabled: true }, { dailyDigestEnabled: true }, { quietHoursStart: "24:00" }, { quietHoursEnd: "22:00" }, { quietHoursStart: "" }, { ownerId: "other" }, { defaultOffsetMinutes: -1 }]) {
    await assert.rejects(f.companion.savePreferences("owner", invalid), rejected(400));
  }
  assert.equal((await f.companion.preferences("owner")).quietHoursEnd, "07:00");
});

test("quiet hours reject future reminder edits without changing existing schedules", async context => {
  const f = fixture(context);
  f.reminder();
  await f.assistant.reconcileReminders("owner");
  await f.companion.savePreferences("owner", { quietHoursStart: "22:00", quietHoursEnd: "07:00" });
  assert.equal(f.messages.size, 1);
  await assert.rejects(f.companion.updateReminder("owner", { id: "reminder", revision: 1, eventLocal: "2026-10-07T06:30" }), /quiet hours/i);
  assert.equal(f.rows.get("reminders:reminder")!.revision, 1);
  assert.equal(f.messages.size, 1);
});

test("quiet hours use the user's timezone when an event is scheduled in another timezone", async context => {
  const f = fixture(context);
  f.reminder();
  await f.companion.savePreferences("owner", { timezone: "America/New_York", quietHoursStart: "22:00", quietHoursEnd: "07:00" });
  // 8 PM in Los Angeles is 11 PM in the user's New York quiet hours.
  await assert.rejects(f.companion.updateReminder("owner", { id: "reminder", revision: 1, eventLocal: "2026-10-07T20:00", timezone: "America/Los_Angeles", offsetMinutes: 0 }), /quiet hours/i);
  const result = await f.companion.updateReminder("owner", { id: "reminder", revision: 1, eventLocal: "2026-10-07T06:00", timezone: "America/Los_Angeles", offsetMinutes: 0 });
  assert.equal(result.remindAt, "2026-10-07T13:00:00Z");
});

test("disabling SMS disconnects and cannot be silently reenabled without a verified connection", async context => {
  const f = fixture(context);
  const preferences = await f.companion.savePreferences("owner", { smsEnabled: false });
  assert.equal(preferences.smsEnabled, false);
  assert.equal(f.disconnected(), true);
  await assert.rejects(f.companion.savePreferences("owner", { smsEnabled: true }));
  assert.equal((await f.companion.preferences("owner")).smsEnabled, false);
});

test("a lost preference commit acknowledgement still completes SMS disconnection", async context => {
  const f = fixture(context);
  const commit = f.tables.updateTransaction.bind(f.tables);
  let commits = 0;
  context.mock.method(f.tables, "updateTransaction", async (input: { transactionId: string; commit?: boolean; rollback?: boolean }) => {
    const result = await commit(input);
    if (input.commit && ++commits === 2) throw new Error("Lost commit acknowledgement");
    return result;
  });
  const preferences = await f.companion.savePreferences("owner", { smsEnabled: false });
  assert.equal(preferences.smsEnabled, false);
  assert.equal(f.disconnected(), true);
});
