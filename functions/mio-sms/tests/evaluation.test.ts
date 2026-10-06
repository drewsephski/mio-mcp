import assert from "node:assert/strict";
import { test } from "node:test";
import { loadEnvFile } from "node:process";
import { createAgent } from "../src/agent.ts";
import { createSmsService } from "../src/service.ts";
import { backend } from "./backend.ts";

// Opt-in paid inference. All tools run against an isolated in-memory backend;
// this corpus cannot access production rows, phone numbers, or Messaging.
test("live Luna conversational evaluation", { skip: process.env.MIO_LIVE_EVAL !== "1", timeout: 240_000 }, async context => {
  loadEnvFile(".env.local");
  assert.ok(process.env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY is required");
  const db = backend(context);
  const summaries: { tools: string[]; failedTools: string[] }[] = [];
  const service = createSmsService(db.tables, db.users, db.messaging, {
    databaseId: "mio", providerId: "provider", phone: "+15550000002", timezone: "America/Chicago",
    now: () => new Date("2026-10-06T17:00:00Z"),
    agent: createAgent({ apiKey: process.env.OPENROUTER_API_KEY, model: process.env.MIO_AI_MODEL, observeStep: summary => summaries.push(summary) }),
  });
  let sid = 0;
  async function turn(text: string) {
    summaries.length = 0;
    const MessageSid = `SM${(++sid).toString(16).padStart(32, "0")}`;
    await service.inbound({ AccountSid: `AC${"a".repeat(32)}`, MessageSid, From: "+15550000001", To: "+15550000002", Body: text, NumMedia: 0 });
    await service.work("owner");
    const receipt = db.rows.get(`sms_receipts:${MessageSid}`);
    if (!receipt) console.log({ turn: sid, summaries });
    assert.ok(receipt, "Model must finish the turn without retries");
    assert.equal(receipt.replyQueued, true);
    console.log(`PASS live Luna turn ${sid}`); // Never log prompt/reply text.
    return String(receipt.reply);
  }
  await turn("Remember I want Shiplog to make weekly recaps.");
  assert.equal(db.rowsIn("notes").length, 1); const noteId = db.rowsIn("notes")[0].$id;
  await turn("Actually make that daily.");
  assert.equal(db.rowsIn("notes").length, 1); assert.equal(db.rowsIn("notes")[0].$id, noteId);
  assert.match(String(db.rowsIn("notes")[0].body), /daily/i);
  assert.match(await turn("What did I say about Shiplog?"), /daily/i);
  await turn("Delete that note."); assert.equal(db.rowsIn("notes").length, 0);
  await turn("Remind me I have work at 4");
  assert.equal(db.rowsIn("notes").length, 1); assert.equal(db.rowsIn("reminders").length, 1);
  const reminder = db.rowsIn("reminders")[0], reminderId = reminder.$id, oldMessageId = String(reminder.messageId);
  assert.equal(reminder.eventAt, "2026-10-06T21:00:00Z"); assert.equal(reminder.remindAt, "2026-10-06T20:45:00Z");
  await turn("Actually work is at 4:30");
  if (db.rowsIn("reminders")[0].eventAt !== "2026-10-06T21:30:00Z") console.log({ turn: 6, summaries });
  assert.equal(db.rowsIn("notes").length, 1); assert.equal(db.rowsIn("reminders")[0].$id, reminderId);
  assert.equal(db.rowsIn("reminders")[0].eventAt, "2026-10-06T21:30:00Z"); assert.equal(db.rowsIn("reminders")[0].remindAt, "2026-10-06T21:15:00Z");
  assert.ok(db.deletedMessages.includes(oldMessageId));
  await turn("And remind me 20 minutes before"); assert.equal(db.rowsIn("reminders")[0].remindAt, "2026-10-06T21:10:00Z");
  await turn("cancel that reminder"); assert.equal(db.rowsIn("reminders")[0].status, "canceled");
  await turn("remind me tomorrow morning to check Browser Company");
  const tomorrow = db.rowsIn("reminders").at(-1)!;
  assert.equal(tomorrow.remindAt, "2026-10-07T14:00:00Z");
  await turn("make that 10 instead");
  if (db.rows.get(`reminders:${tomorrow.$id}`)!.remindAt !== "2026-10-07T15:00:00Z") console.log({ turn: 10, summaries });
  assert.equal(db.rows.get(`reminders:${tomorrow.$id}`)!.remindAt, "2026-10-07T15:00:00Z");
  await turn("Remind me I have work tomorrow at 4 PM.");
  const nextWork = db.rowsIn("reminders").at(-1)!;
  assert.equal(nextWork.eventAt, "2026-10-07T21:00:00Z");
  await turn("Actually work is at 4:30.");
  assert.equal(db.rows.get(`reminders:${nextWork.$id}`)!.eventAt, "2026-10-07T21:30:00Z");
  db.seed("notes", "workA", { ownerId: "owner", title: "Work at 4:30", body: "Work today at 4:30", archived: false });
  db.seed("notes", "workB", { ownerId: "owner", title: "Finish work dashboard", body: "Work dashboard", archived: false });
  const before = db.rowsIn("notes").length;
  assert.match(await turn("Delete the work note"), /which|work at|dashboard|mean|clarif/i);
  assert.equal(db.rowsIn("notes").length, before);
});
