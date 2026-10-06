import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Account, Client, ExecutionMethod, Functions, Permission, Role, TablesDB, Query } from "node-appwrite";
import { releaseClient, safeFailure } from "./release/client.mjs";
const ctx = releaseClient(), ids = [randomUUID(), randomUUID()], attempted = [], fixtures = [];
const base = () => new Client().setEndpoint(ctx.config.endpoint).setProject(ctx.config.projectId);
async function denied(operation) { await assert.rejects(operation, e => [401,403,404].includes(e.code)); }
try {
  const clients = [], sessions = [];
  for (const userId of ids) {
    const password = `${randomUUID()}Aa1!`, email = `mio-isolation-${userId}@example.com`;
    attempted.push(userId);
    await ctx.users.create({ userId, email, password });
    await ctx.users.updateEmailVerification({ userId, emailVerification: true });
    await ctx.users.updateLabels({ userId, labels: ["mioBeta"] });
    const session = await new Account(base().setKey(process.env.APPWRITE_API_KEY)).createEmailPasswordSession({ email, password });
    sessions.push(session.secret);
    clients.push(new TablesDB(base().setSession(session.secret)));
  }
  const functions = new Functions(base().setSession(sessions[0]));
  for (const path of ["/operator", "/admission", "/reminders", "/challenge"]) {
    const result = await functions.createExecution({ functionId: "mio-sms", xpath: path, method: path === "/challenge" ? ExecutionMethod.POST : ExecutionMethod.GET,
      body: path === "/challenge" ? JSON.stringify({ consent: true, consentVersion: "2026-10-06" }) : undefined, async: false });
    assert.equal(result.responseStatusCode, 403, `Uninvited account accessed ${path}`);
    console.log(`PASS uninvited account denied ${path}`);
  }
  const ready = await functions.createExecution({ functionId: "mio-sms", xpath: "/ready", method: ExecutionMethod.GET, async: false });
  assert.equal(ready.responseStatusCode, 401);
  const site = await ctx.sites.get({ siteId: "mio-web" });
  const siteUrl = site.vars.find(x => x.key === "APP_URL").value;
  const operator = await fetch(new URL("/operator", siteUrl), { headers: { cookie: `appwrite-session-${ctx.config.projectId}=${sessions[0]}` }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  assert.equal(operator.status, 404, "Normal user accessed operator page");
  const unauthenticatedReady = await fetch(new URL("/api/ready", siteUrl), { signal: AbortSignal.timeout(30_000) });
  assert.equal(unauthenticatedReady.status, 401);
  console.log("PASS normal user cannot access operator page; readiness requires its separate token");
  await ctx.users.updateLabels({ userId: ids[0], labels: [] });
  const blockedNoteId = randomUUID();
  fixtures.push({ databaseId: "mio", tableId: "notes", rowId: blockedNoteId, ownerId: ids[0] });
  await denied(() => clients[0].createRow({ databaseId: "mio", tableId: "notes", rowId: blockedNoteId, data: { ownerId: ids[0], title: "Blocked", body: "Synthetic", archived: false, source: "web", completed: false, project: "" } }));
  console.log("PASS externally created unadmitted account cannot create Mio notes");
  const other = ids[1];
  const tableFixtures = [
    ["reminders", { ownerId: other, noteId: "", eventAt: "2099-01-01T12:00:00Z", remindAt: "2099-01-01T12:00:00Z", timezone: "UTC", message: "Synthetic isolation fixture", status: "canceled", revision: 1, messageId: "", appliedMessageId: "", targetId: "fixture", syncPending: false, lastError: "" }],
    ["sms_turns", { ownerId: other, userText: "Synthetic fixture", reply: "Synthetic reply", noteIds: [], reminderIds: [], outcomes: ["no_action"] }],
    ["sms_connections", { ownerId: other, phone: "+1999" + Date.now().toString().slice(-7), targetId: "fixture" }],
    ["sms_conversations", { ownerId: other, timezone: "UTC", defaultOffsetMinutes: 15, leaseToken: "", leaseUntil: new Date(0).toISOString() }],
    ["usage_daily", { ownerId: other, date: "2099-01-01", inboundSms: 0, outboundSms: 0, aiTurns: 0, inputTokens: 0, outputTokens: 0, aiReservedMicros: 0, smsReservedMicros: 0 }],
  ];
  for (const [tableId,data] of tableFixtures) {
    const rowId = randomUUID(), args = { databaseId: "mio", tableId, rowId };
    fixtures.push({ ...args, ownerId: other });
    await ctx.tables.createRow({ ...args, data, permissions: [Permission.read(Role.user(other))] });
    const owned = await clients[1].getRow(args); assert.equal(owned.ownerId, other);
    await denied(() => clients[0].getRow(args));
    await denied(() => clients[0].updateRow({ ...args, data: { ownerId: ids[0] } }));
    await denied(() => clients[0].deleteRow(args));
    const page = await clients[0].listRows({ databaseId: "mio", tableId, queries: [Query.equal("$id", rowId)] });
    assert.equal(page.rows.length, 0);
    console.log(`PASS A cannot retrieve, alter, delete or list B ${tableId}`);
  }
  const bypassId = randomUUID(); attempted.push(bypassId);
  await assert.rejects(new Account(base()).create({ userId: bypassId, email: `mio-bypass-${bypassId}@example.com`, password: `${randomUUID()}Aa1!` }), e => [401,403,412].includes(e.code) || e.type === "user_count_exceeded");
  console.log("PASS public Auth signup is closed; server-created invited flow remains possible");
} catch (e) { console.error(safeFailure(e)); process.exitCode = 1; }
finally {
  for (const f of fixtures.reverse()) {
    try { const row = await ctx.tables.getRow(f); assert.equal(row.ownerId, f.ownerId); await ctx.tables.deleteRow(f); }
    catch(e) { if(e.code!==404) { console.error("Fixture cleanup failed", {tableId:f.tableId,rowId:f.rowId});process.exitCode=1; } }
  }
  for (const userId of attempted) {
    try { const u = await ctx.users.get({userId}); assert.ok(u.email.startsWith("mio-isolation-") || u.email.startsWith("mio-bypass-")); await ctx.users.delete({userId}); }
    catch(e) { if(e.code!==404) { console.error("Identity cleanup failed",{userId});process.exitCode=1; } }
  }
}
