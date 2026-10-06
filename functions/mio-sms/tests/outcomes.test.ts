import assert from "node:assert/strict";
import { test } from "node:test";
import { backend } from "./backend.ts";
import { createAssistant } from "../src/assistant.ts";
import type { AgentRunner } from "../src/agent.ts";

async function toolCall(input: Parameters<AgentRunner>[0], name: string, args: Record<string, unknown>) {
  return input.tools[name].execute!(args, { toolCallId: "test", messages: [], abortSignal: input.signal, context: undefined });
}
const message = { MessageSid: "SM" + "1".repeat(32), From: "+15550000001", To: "+15550000002", Body: "Remember to call Sarah", AccountSid: "AC" + "1".repeat(32), NumMedia: 0 };
test("committed outcome metadata comes from successful tools and survives a lost commit response", async context => {
  const db = backend(context); db.loseCommit();
  const assistant = createAssistant(db.tables, db.users, db.messaging, { databaseId: "mio", now: () => new Date("2026-10-06T12:00:00Z"), agent: async input => { await toolCall(input, "createNote", { title: "Call Sarah", body: "Call Sarah tomorrow" }); return "Remembered."; } });
  await assistant.enqueue(message, db.rowsIn("sms_connections")[0] as never); await assistant.processPending();
  assert.deepEqual(db.rowsIn("sms_turns")[0].outcomes, ["created_note"]);
});
test("rolled-back actions never become successful outcome metadata", async context => {
  const db = backend(context);
  let now = Date.parse("2026-10-06T12:00:00Z");
  const assistant = createAssistant(db.tables, db.users, db.messaging, { databaseId: "mio", now: () => new Date(now), agent: async input => { await toolCall(input, "createNote", { title: "Call Sarah", body: "Call Sarah tomorrow" }); throw new Error("generation failed"); } });
  await assistant.enqueue(message, db.rowsIn("sms_connections")[0] as never);
  for (let i=0;i<3;i++) { await assistant.processPending(); now += 5*60_000; }
  assert.equal(db.rowsIn("notes").length, 0); assert.deepEqual(db.rowsIn("sms_turns")[0].outcomes, ["failed"]);
});
test("clarification is a performed non-mutating tool request", async context => {
  const db = backend(context);
  const assistant = createAssistant(db.tables, db.users, db.messaging, { databaseId: "mio", now: () => new Date("2026-10-06T12:00:00Z"), agent: async input => { await toolCall(input, "askClarification", { reason: "target" }); return "Which reminder?"; } });
  await assistant.enqueue(message, db.rowsIn("sms_connections")[0] as never); await assistant.processPending();
  assert.deepEqual(db.rowsIn("sms_turns")[0].outcomes, ["clarification"]); assert.equal(db.rowsIn("notes").length, 0);
});
