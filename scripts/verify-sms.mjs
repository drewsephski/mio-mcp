import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { AppwriteException, Client, Functions, Messaging, Permission, Query, Role, TablesDB, Users } from "node-appwrite";
import { createSmsService } from "../functions/mio-sms/src/service.ts";
import { captureText } from "../functions/mio-sms/src/inbound.ts";

loadEnvFile(".env.local"); loadEnvFile(".env.provisioning");
const base = () => new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT).setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID);
const admin = base().setKey(process.env.APPWRITE_PROVISIONING_KEY);
const tables = new TablesDB(admin), users = new Users(admin), adminMessaging = new Messaging(admin);
const config = JSON.parse(readFileSync("appwrite.config.json", "utf8"));
const expectedScopes = config.functions.find(entry => entry.$id === "mio-sms").scopes;
const deployed = await new Functions(admin).get({ functionId: "mio-sms" });
assert.deepEqual([...deployed.scopes].sort(), [...expectedScopes].sort(), "Live Function scopes must match versioned configuration");
// Exercise the same permissions as the deployed dynamic Function key. The
// privileged provisioning client is used only for fixtures/inspection/cleanup.
let scopedKey;
try {
  scopedKey = JSON.parse(execFileSync("appwrite", ["project", "create-ephemeral-key", "--duration", "600", ...expectedScopes.flatMap(scope => ["--scopes", scope]), "--raw", "--show-secrets"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
} catch { throw new Error("Could not obtain the short-lived Function-scope verification key. Sign into the Appwrite CLI."); }
const serviceClient = base().setKey(scopedKey.secret);
const serviceTables = new TablesDB(serviceClient);
const messaging = new Messaging(serviceClient);
const providerId = "6ac51435002ef67f3ecd";
// This verifier persists real Cloud state but ALL messages are drafts. It never
// sends an SMS to these synthetic test numbers or claims carrier acceptance.
const originalCreateSMS = messaging.createSMS.bind(messaging);
const originalUpdateSMS = messaging.updateSMS.bind(messaging);
messaging.updateSMS = params => originalUpdateSMS({ ...params, draft: true });
let loseReplyResponse = false;
messaging.createSMS = async (params) => {
  const message = await originalCreateSMS({ ...params, draft: true });
  if (loseReplyResponse) { loseReplyResponse = false; throw new Error("Simulated lost reply response"); }
  return message;
};
const service = createSmsService(serviceTables, new Users(serviceClient), messaging, { databaseId: "mio", providerId, phone: "+12242866565", verificationMode: true, agent: async input => {
  const capture = captureText({ Body: input.text, NumMedia: 0 });
  await input.tools.createNote.execute({ title: capture.title, body: capture.body }, { toolCallId: "verify", messages: [], abortSignal: input.signal });
  return "Saved your thought.";
} });
const ids = [randomUUID(), randomUUID()];
const sids = [0, 1, 2].map(() => `SM${randomBytes(16).toString("hex")}`);
const reminderFixtureId = randomUUID();
const phone = `+1555${String(Date.now()).slice(-7)}`;
const resource = (tableId, rowId) => ({ databaseId: "mio", tableId, rowId });
const message = (sid, Body) => ({ AccountSid: `AC${"a".repeat(32)}`, MessageSid: sid, From: phone, To: "+12242866565", Body, NumMedia: 0 });
let passCount = 0;
function pass(label) { passCount++; console.log(`PASS ${label}`); }
async function denied(operation) {
  await assert.rejects(operation, error => error instanceof AppwriteException && [401, 403, 404].includes(error.code));
}
try {
  for (const id of ids) await users.create({ userId: id, email: `mio-sms-${id}@example.com`, password: `${randomUUID()}Aa9!`, name: "SMS integration test" });
  const sessions = await Promise.all(ids.map(userId => users.createSession({ userId })));
  const owner = new TablesDB(base().setSession(sessions[0].secret));
  const other = new TablesDB(base().setSession(sessions[1].secret));
  const first = await service.challenge(ids[0]);
  const second = await service.challenge(ids[0]);
  assert.ok((await service.inbound(message(sids[0], `connect ${first.code}`))).notice);
  assert.equal((await service.status(ids[0])).connected, false);
  pass("Rotated connection code cannot bind a phone");
  const existingTargetId = randomUUID();
  await users.createTarget({ userId: ids[1], targetId: existingTargetId, providerType: "sms", identifier: phone, providerId });
  assert.match((await service.inbound(message(sids[0], `connect ${second.code}`))).notice, /couldn't connect/);
  assert.equal((await service.status(ids[0])).connected, false);
  assert.equal((await users.getTarget({ userId: ids[1], targetId: existingTargetId })).identifier, phone);
  await users.deleteTarget({ userId: ids[1], targetId: existingTargetId });
  await users.createTarget({ userId: ids[0], targetId: existingTargetId, providerType: "sms", identifier: phone, providerId });
  await service.inbound(message(sids[0], `connect ${second.code}`));
  assert.equal((await tables.getRow(resource("sms_connections", ids[0]))).targetId, existingTargetId);
  pass("Existing targets are reused only for their verified owner; another account's target is never moved or used");
  assert.equal((await service.status(ids[0])).phone, phone);
  assert.equal((await owner.getRow(resource("sms_connections", ids[0]))).ownerId, ids[0]);
  await denied(() => other.getRow(resource("sms_connections", ids[0])));
  await denied(() => owner.updateRow({ ...resource("sms_connections", ids[0]), data: { phone: "+15550000000" } }));
  await denied(() => owner.getRow(resource("sms_challenges", ids[0])));
  await denied(() => owner.createRow({ ...resource("sms_receipts", sids[2]), data: { ownerId: ids[0], phone, targetId: "forged", payloadHash: "a".repeat(64), reply: "forged", replyQueued: false } }));
  pass("Connection is verified, owner-readable, and server-write-only; challenges and receipts are inaccessible");
  // Reconcile a canceled fixture through the real fenced TablesDB update.
  // Cancellation never creates a Messaging message, even if a production
  // worker encounters this synthetic row.
  await tables.createRow({ ...resource("reminders", reminderFixtureId), data: {
    ownerId: ids[0], noteId: "", eventAt: new Date(Date.now() + 86_400_000).toISOString(), remindAt: new Date(Date.now() + 85_500_000).toISOString(),
    timezone: "America/Chicago", message: "Private verification reminder", status: "canceled", revision: 1,
    messageId: randomUUID(), appliedMessageId: "", targetId: existingTargetId, syncPending: true, lastError: "",
  }, permissions: [Permission.read(Role.user(ids[0]))] });
  await service.work(ids[0]);
  assert.equal((await tables.getRow(resource("reminders", reminderFixtureId))).syncPending, false);
  assert.equal((await owner.getRow(resource("reminders", reminderFixtureId))).ownerId, ids[0]);
  await denied(() => other.getRow(resource("reminders", reminderFixtureId)));
  await denied(() => owner.updateRow({ ...resource("reminders", reminderFixtureId), data: { message: "forged" } }));
  await denied(() => owner.deleteRow(resource("reminders", reminderFixtureId)));
  pass("Reminder rows are private, owner-readable and server-write-only; a canceled fixture cannot schedule SMS");
  const text = "Need to add streaming responses to LaunchStack tomorrow";
  loseReplyResponse = true;
  await Promise.allSettled([service.inbound(message(sids[1], text)), service.inbound(message(sids[1], text))]);
  await service.work(ids[0]);
  await service.inbound(message(sids[1], text));
  const turn = await tables.getRow(resource("sms_turns", sids[1]));
  const captured = await owner.getRow(resource("notes", turn.noteIds[0]));
  assert.equal(captured.body, text); assert.equal(captured.source, "sms");
  assert.equal(captured.title, "Add streaming responses to LaunchStack tomorrow");
  assert.deepEqual(captured.$permissions.sort(), [Permission.read(Role.user(ids[0])), Permission.update(Role.user(ids[0])), Permission.delete(Role.user(ids[0]))].sort());
  await denied(() => other.getRow(resource("notes", captured.$id)));
  await denied(() => other.getRow(resource("sms_turns", sids[1])));
  await denied(() => owner.updateRow({ ...resource("sms_turns", sids[1]), data: { reply: "forged" } }));
  await denied(() => owner.getRow(resource("sms_jobs", sids[1])));
  const receipt = await tables.getRow(resource("sms_receipts", sids[1]));
  assert.equal(receipt.replyQueued, true);
  const draft = await messaging.getMessage({ messageId: sids[1] });
  assert.equal(draft.status, "draft"); assert.deepEqual(draft.targets, [receipt.targetId]);
  const notes = await tables.listRows({ databaseId: "mio", tableId: "notes", queries: [Query.equal("ownerId", ids[0])] });
  assert.equal(notes.rows.length, 1);
  pass("Concurrent deliveries persist exactly one private SMS note and one draft reply; lost reply response reconciles");
  await owner.deleteRow(resource("notes", captured.$id));
  await service.inbound(message(sids[1], text));
  await assert.rejects(() => owner.getRow(resource("notes", captured.$id)), error => error.code === 404);
  await assert.rejects(() => service.inbound(message(sids[1], "Different payload")), /identity mismatch/);
  pass("Replay after note deletion cannot resurrect the note; changed payload under one SID is rejected");
  const originalCommit = serviceTables.updateTransaction.bind(serviceTables);
  let loseCommitResponse = true;
  serviceTables.updateTransaction = async params => {
    const result = await originalCommit(params);
    if (params.commit && loseCommitResponse) { loseCommitResponse = false; throw new Error("Simulated lost commit response"); }
    return result;
  };
  await service.inbound(message(sids[2], "Another thought"));
  await service.work(ids[0]);
  const anotherTurn = await tables.getRow(resource("sms_turns", sids[2]));
  assert.equal((await owner.getRow(resource("notes", anotherTurn.noteIds[0]))).body, "Another thought");
  pass("Lost transaction commit response resolves from the durable receipt without replaying capture");
  await tables.updateRow({ ...resource("sms_receipts", sids[2]), data: { replyQueued: false } });
  await service.disconnect(ids[0]);
  await service.retryReplies();
  assert.equal((await service.status(ids[0])).connected, false);
  assert.equal((await tables.getRow(resource("sms_receipts", sids[2]))).replyQueued, true);
  assert.equal((await service.inbound(message(`SM${randomBytes(16).toString("hex")}`, "After disconnect"))).handled, false);
  pass("Disconnect revokes capture and cancels pending replies instead of sending private content");
  console.log(`Verified ${passCount} live Cloud SMS checks. Outbound messages were drafts; carrier/inbound-phone acceptance is separate.`);
} catch (error) {
  console.error({ code: error.code ?? null, type: error.type ?? null, message: error instanceof assert.AssertionError ? error.message : "SMS verification failed" });
  process.exitCode = 1;
} finally {
  const failures = [];
  await tables.deleteRow(resource("reminders", reminderFixtureId)).catch(error => { if (error.code !== 404) failures.push("reminder-fixture"); });
  for (const sid of sids) {
    for (const tableId of ["sms_jobs", "sms_turns", "sms_receipts"]) await tables.deleteRow(resource(tableId, sid)).catch(error => { if (error.code !== 404) failures.push(`${tableId}:${sid}`); });
    await adminMessaging.delete({ messageId: sid }).catch(error => { if (error.code !== 404) failures.push(`message:${sid}`); });
  }
  for (const id of ids) {
    const notes = await tables.listRows({ databaseId: "mio", tableId: "notes", queries: [Query.equal("ownerId", id), Query.limit(100)] });
    for (const note of notes.rows) await tables.deleteRow(resource("notes", note.$id)).catch(() => failures.push("test-note"));
    for (const tableId of ["sms_connections", "sms_challenges", "sms_conversations"]) await tables.deleteRow(resource(tableId, id)).catch(error => { if (error.code !== 404) failures.push(`${tableId}:${id}`); });
    await users.delete({ userId: id }).catch(error => { if (error.code !== 404) failures.push(`user:${id}`); });
  }
  assert.equal(failures.length, 0, `Cleanup needs attention: ${failures.join(", ")}`);
}
