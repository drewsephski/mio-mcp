import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompanionClient, messagesLink, type CompanionPort } from "../packages/domain/src/mobile-client.ts";
function fixture() {
  const user = { $id: "userA", email: "a@example.com", name: "A", status: true, emailVerification: true };
  const note = { $id: "noteA", ownerId: "userA", title: "A", body: "Private", archived: false, $updatedAt: "2026-10-06T12:00:00Z" };
  const calls: unknown[][] = [];
  const port: CompanionPort = {
    account: async () => user, signIn: async (...args) => { calls.push(["signIn", ...args]); }, signOut: async () => { calls.push(["signOut"]); },
    call: async (path, body, query) => { calls.push([path, body, query]); return { admitted: true }; },
    listNotes: async (owner, cursor) => { calls.push(["notes", owner, cursor]); return [note]; },
    getNote: async () => note, updateNote: async (id, input) => { calls.push(["update", id, input]); return { ...note, ...input }; },
  };
  return { user, note, calls, port, client: createCompanionClient(port) };
}
test("mobile session requires verification and independent server admission", async () => {
  const f = fixture();
  f.user.emailVerification = false;
  await assert.rejects(f.client.session(), /Verify/);
  assert.equal(f.calls.length, 0);
  f.user.emailVerification = true;
  f.port.call = async () => { throw new Error("Invite-only"); };
  await assert.rejects(f.client.signIn("a@example.com", "password"), /Invite-only/);
  assert.deepEqual(f.calls.at(-1), ["signOut"]);
});
test("mobile never writes a foreign note and only sends validated note fields", async () => {
  const f = fixture();
  f.note.ownerId = "userB";
  await assert.rejects(f.client.saveNote("noteA", { title: "New", body: "Text" }), /unavailable/);
  assert.ok(!f.calls.some(c => c[0] === "update"));
  f.note.ownerId = "userA";
  await assert.rejects(f.client.saveNote("noteA", { title: "New", body: "Text", ownerId: "userB" }));
  await f.client.saveNote("noteA", { title: " New ", body: "Text" });
  assert.deepEqual(f.calls.at(-1), ["update", "noteA", { title: "New", body: "Text" }]);
});
test("mobile list scopes the authenticated owner and rejects foreign results/cursors", async () => {
  const f = fixture();
  await f.client.notes("cursorA");
  assert.deepEqual(f.calls.at(-1), ["notes", "userA", "cursorA"]);
  await assert.rejects(f.client.notes("../bad"));
  f.note.ownerId = "userB";
  await assert.rejects(f.client.notes(), /unavailable/);
});
test("uncertain native note mutation is never automatically replayed", async () => {
  const f = fixture(); let attempts = 0;
  f.port.updateNote = async () => { attempts++; throw new Error("lost response"); };
  await assert.rejects(f.client.saveNote("noteA", { title: "New", body: "Text" }), /lost response/);
  assert.equal(attempts, 1);
});
test("native cancellation uses the existing revision-fenced Function API", async () => {
  const f = fixture();
  f.port.call = async (path, body) => { f.calls.push([path, body]); if (path === "/admission") return { admitted: true }; throw new Error("This reminder changed. Refresh it before editing."); };
  await assert.rejects(f.client.cancelReminder("reminderA", 4), /changed/);
  assert.deepEqual(f.calls.at(-1), ["/reminders/cancel", { id: "reminderA", revision: 4 }]);
});
test("Text Mio opens the one configured number and safely encodes a suggested text", () => {
  assert.equal(messagesLink("+15555550100", "Remember Sarah & me"), "sms:+15555550100&body=Remember%20Sarah%20%26%20me");
  assert.throws(() => messagesLink("javascript:bad"));
});
