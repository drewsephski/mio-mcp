import { randomUUID } from "node:crypto";
import { AppwriteException, Permission, Query, Role, type Messaging, type Models, type TablesDB, type Users } from "node-appwrite";
import { createAgent, type AgentRunner } from "./agent.ts";
import type { Notes, Reminders, SmsConnections, SmsConversations, SmsJobs, SmsReceipts, SmsTurns } from "./generated.ts";
import { payloadHash, SmsError, type Inbound } from "./inbound.ts";
import { createMioTools } from "./tools.ts";
import { hasVerifiedBetaAccess } from "./beta.ts";
import { parsePreferences } from "./preferences.ts";
import { UsageLimitError, type createUsageControls } from "./usage.ts";
import { timezoneSchema } from "./time.ts";

export type AssistantConfig = {
  databaseId: string; timezone?: string; defaultOffsetMinutes?: number; agent?: AgentRunner;
  apiKey?: string; model?: string; now?: () => Date; timeoutMs?: number;
  log?: (event: string) => void;
  invitedEmails?: readonly string[];
  usage?: ReturnType<typeof createUsageControls>;
  // Local Cloud verifier only; never populated from an HTTP request. Production
  // event/schedule workers do not select these draft-only fixture jobs.
  verificationMode?: boolean;
};
const missing = (error: unknown) => error instanceof AppwriteException && error.code === 404;
const conflict = (error: unknown) => error instanceof AppwriteException && error.code === 409;

export function createAssistant(tables: TablesDB, users: Users, messaging: Messaging, config: AssistantConfig) {
  const resource = (tableId: string) => ({ databaseId: config.databaseId, tableId });
  const now = config.now ?? (() => new Date());
  const agent = config.agent ?? createAgent({ apiKey: config.apiKey, model: config.model });
  const defaultTimezone = timezoneSchema.parse(config.timezone ?? "America/Chicago");
  const defaultOffsetMinutes = config.defaultOffsetMinutes ?? 15;
  const queuedStatus = config.verificationMode ? "verification" : "queued";
  if (!Number.isInteger(defaultOffsetMinutes) || defaultOffsetMinutes < 0 || defaultOffsetMinutes > 10080) throw new Error("Invalid default reminder offset");
  async function optional<T extends Models.Row>(tableId: string, rowId: string): Promise<T | null> {
    try { return await tables.getRow<T>({ ...resource(tableId), rowId }); }
    catch (error) { if (missing(error)) return null; throw error; }
  }
  async function ensureConversation(ownerId: string) {
    if (await optional<SmsConversations>("sms_conversations", ownerId)) return;
    const user = await users.get({ userId: ownerId });
    const preferred = timezoneSchema.safeParse(user.prefs.timezone);
    try {
      await tables.createRow({ ...resource("sms_conversations"), rowId: ownerId, data: {
        ownerId, timezone: preferred.success ? preferred.data : defaultTimezone, defaultOffsetMinutes,
        leaseToken: "", leaseUntil: new Date(0).toISOString(), quietHoursStart: "", quietHoursEnd: "", smsEnabled: true, proactiveMessagesEnabled: false, dailyDigestEnabled: false,
      }, permissions: [Permission.read(Role.user(ownerId))] });
    } catch (error) { if (!conflict(error)) throw error; }
  }
  async function enqueue(message: Inbound, connection: SmsConnections) {
    const existing = await optional<SmsJobs>("sms_jobs", message.MessageSid);
    if (existing) {
      if (existing.payloadHash !== payloadHash(message)) throw new SmsError("Message identity mismatch", 409);
      return;
    }
    await ensureConversation(connection.ownerId);
    const transaction = await tables.createTransaction({ ttl: 60 });
    try {
      const current = await tables.getRow<SmsConnections>({ ...resource("sms_connections"), rowId: connection.ownerId, transactionId: transaction.$id });
      if (current.phone !== message.From || current.targetId !== connection.targetId) throw new SmsError("Binding changed", 409);
      await tables.updateRow({ ...resource("sms_connections"), rowId: connection.ownerId, data: { phone: current.phone }, transactionId: transaction.$id });
      await tables.createRow({ ...resource("sms_jobs"), rowId: message.MessageSid, data: {
        ownerId: connection.ownerId, phone: message.From, targetId: connection.targetId, payloadHash: payloadHash(message), body: message.Body,
        status: queuedStatus, attempts: 0, nextAttemptAt: now().toISOString(),
      }, permissions: [], transactionId: transaction.$id });
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    } catch (error) {
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {});
      const persisted = await optional<SmsJobs>("sms_jobs", message.MessageSid);
      if (!persisted) throw error;
      if (persisted.payloadHash !== payloadHash(message)) throw new SmsError("Message identity mismatch", 409);
    }
  }
  // One fenced lease serializes both conversational turns and Messaging
  // reconciliation for an owner. Transactions also touch the lease, so a stale
  // worker cannot commit after another execution has acquired it.
  async function acquire(ownerId: string) {
    await ensureConversation(ownerId);
    const token = randomUUID();
    const transaction = await tables.createTransaction({ ttl: 60 });
    try {
      const row = await tables.getRow<SmsConversations>({ ...resource("sms_conversations"), rowId: ownerId, transactionId: transaction.$id });
      if (Date.parse(row.leaseUntil) > now().getTime()) {
        await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }); return null;
      }
      await tables.updateRow({ ...resource("sms_conversations"), rowId: ownerId, data: { leaseToken: token, leaseUntil: new Date(now().getTime() + 150_000).toISOString() }, transactionId: transaction.$id });
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    } catch (error) {
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {});
      const row = await optional<SmsConversations>("sms_conversations", ownerId);
      if (row?.leaseToken !== token) { if (conflict(error)) return null; throw error; }
    }
    return token;
  }
  async function fence(ownerId: string, token: string, transactionId: string) {
    const conversation = await tables.getRow<SmsConversations>({ ...resource("sms_conversations"), rowId: ownerId, transactionId });
    if (conversation.leaseToken !== token || Date.parse(conversation.leaseUntil) <= now().getTime()) throw new Error("Worker lease expired");
    await tables.updateRow({ ...resource("sms_conversations"), rowId: ownerId, data: { leaseToken: token }, transactionId });
    return conversation;
  }
  async function release(ownerId: string, token: string) {
    const transaction = await tables.createTransaction({ ttl: 60 });
    try {
      const row = await tables.getRow<SmsConversations>({ ...resource("sms_conversations"), rowId: ownerId, transactionId: transaction.$id });
      if (row.leaseToken === token) await tables.updateRow({ ...resource("sms_conversations"), rowId: ownerId, data: { leaseToken: "", leaseUntil: new Date(0).toISOString() }, transactionId: transaction.$id });
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    } catch { await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {}); }
  }
  async function binding(job: Pick<SmsJobs, "ownerId" | "phone" | "targetId">, transactionId?: string) {
    let connection;
    try { connection = await tables.getRow<SmsConnections>({ ...resource("sms_connections"), rowId: job.ownerId, transactionId }); }
    catch (error) { if (missing(error)) return false; throw error; }
    const user = await users.get({ userId: job.ownerId });
    const conversation = await optional<SmsConversations>("sms_conversations", job.ownerId);
    if (!user.status || !hasVerifiedBetaAccess(user, config.invitedEmails) || conversation?.smsEnabled === false || connection.phone !== job.phone || connection.targetId !== job.targetId) return false;
    if (transactionId) await tables.updateRow({ ...resource("sms_connections"), rowId: job.ownerId, data: { phone: connection.phone }, transactionId });
    return true;
  }
  async function processJob(job: SmsJobs, token: string) {
    if (await optional<SmsReceipts>("sms_receipts", job.$id)) {
      await tables.updateRow({ ...resource("sms_jobs"), rowId: job.$id, data: { status: "done", body: "" } }); return;
    }
    if (!await binding(job)) {
      await tables.updateRow({ ...resource("sms_jobs"), rowId: job.$id, data: { status: "revoked", body: "" } }); return;
    }
    const attempts = job.attempts + 1;
    await tables.updateRow({ ...resource("sms_jobs"), rowId: job.$id, data: { attempts, nextAttemptAt: new Date(now().getTime() + attempts * 60_000).toISOString() } });
    let aiReservation: { reservationId: string; created: boolean } | undefined;
    if (config.usage) {
      try {
        aiReservation = await config.usage.reserve({ ownerId: job.ownerId, operationId: `${job.$id}:attempt:${attempts}`, kind: "ai" });
        // A duplicate or lost reservation response must never replay a billable call.
        if (!aiReservation.created) return;
      } catch (error) {
        if (!(error instanceof UsageLimitError)) throw error;
        await tables.updateRow({ ...resource("sms_jobs"), rowId: job.$id, data: { attempts: job.attempts, nextAttemptAt: new Date(now().getTime() + 3600_000).toISOString() } });
        return;
      }
    }
    const transaction = await tables.createTransaction({ ttl: 120 });
    try {
      const conversation = await fence(job.ownerId, token, transaction.$id);
      if (!await binding(job, transaction.$id)) throw new Error("Binding revoked");
      const recent = await tables.listRows<SmsTurns>({ ...resource("sms_turns"), queries: [Query.equal("ownerId", job.ownerId), Query.orderDesc("$createdAt"), Query.limit(6)], ttl: 0 });
      if (recent.rows.some(turn => turn.ownerId !== job.ownerId)) throw new Error("Context ownership mismatch");
      const signal = AbortSignal.timeout(config.timeoutMs ?? 45_000);
      const mio = createMioTools(tables, { databaseId: config.databaseId, ownerId: job.ownerId, targetId: job.targetId, turnId: job.$id,
        transactionId: transaction.$id, timezone: conversation.timezone, defaultOffsetMinutes: conversation.defaultOffsetMinutes, now: now(), signal,
        text: job.body, referenceNoteIds: recent.rows[0]?.noteIds ?? [], preferences: parsePreferences(conversation), limits: config.usage?.limits });
      const reply = await agent({ text: job.body, timezone: conversation.timezone, defaultOffsetMinutes: conversation.defaultOffsetMinutes, now: now(),
        observeUsage: config.usage && aiReservation ? metrics => config.usage!.reportUsage(aiReservation.reservationId, metrics) : undefined,
        history: recent.rows.reverse().map(turn => ({ userText: turn.userText, reply: turn.reply, noteIds: turn.noteIds, reminderIds: turn.reminderIds })), tools: mio.tools, signal });
      await mio.assertHealthy();
      if (!reply.trim() || reply.length > 700) throw new Error("Invalid reply");
      await fence(job.ownerId, token, transaction.$id);
      await tables.createRow({ ...resource("sms_turns"), rowId: job.$id, data: { ownerId: job.ownerId, userText: job.body, reply, noteIds: [...mio.noteIds].slice(-10), reminderIds: [...mio.reminderIds].slice(-10) }, permissions: [Permission.read(Role.user(job.ownerId))], transactionId: transaction.$id });
      await tables.createRow({ ...resource("sms_receipts"), rowId: job.$id, data: { ownerId: job.ownerId, phone: job.phone, targetId: job.targetId, payloadHash: job.payloadHash, reply, replyQueued: false, reminderIds: [...mio.reminderIds], deliveryMode: config.verificationMode ? "draft" : "live" }, permissions: [], transactionId: transaction.$id });
      await tables.updateRow({ ...resource("sms_jobs"), rowId: job.$id, data: { status: "done", body: "" }, transactionId: transaction.$id });
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
      config.log?.("assistant_turn_committed");
    } catch {
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {});
      if (await optional<SmsReceipts>("sms_receipts", job.$id)) return; // lost commit response
      config.log?.("assistant_turn_retryable_failure");
      if (attempts < 3) return;
      // A terminal AI failure commits ONLY an honest reply, never partial tools.
      const failed = await tables.createTransaction({ ttl: 60 });
      try {
        await fence(job.ownerId, token, failed.$id);
        if (!await binding(job, failed.$id)) throw new Error("Binding revoked");
        await tables.createRow({ ...resource("sms_receipts"), rowId: job.$id, data: { ownerId: job.ownerId, phone: job.phone, targetId: job.targetId, payloadHash: job.payloadHash,
          reply: "I couldn't finish that request. Nothing was changed. Please try again in a little while.", replyQueued: false, reminderIds: [], deliveryMode: config.verificationMode ? "draft" : "live" }, permissions: [], transactionId: failed.$id });
        await tables.updateRow({ ...resource("sms_jobs"), rowId: job.$id, data: { status: "failed", body: "" }, transactionId: failed.$id });
        await tables.updateTransaction({ transactionId: failed.$id, commit: true });
      } catch (error) { await tables.updateTransaction({ transactionId: failed.$id, rollback: true }).catch(() => {}); throw error; }
    }
  }
  async function processPending(ownerId?: string) {
    const queries = [Query.equal("status", queuedStatus), Query.lessThanEqual("nextAttemptAt", now().toISOString()), Query.orderAsc("$createdAt"), Query.limit(5)];
    if (ownerId) queries.push(Query.equal("ownerId", ownerId));
    const pending = await tables.listRows<SmsJobs>({ ...resource("sms_jobs"), queries, ttl: 0 });
    let processed = 0;
    // One model turn per execution bounds runtime; subsequent jobs remain
    // durable and are drained by events/the minute schedule in arrival order.
    for (const job of pending.rows) {
      const token = await acquire(job.ownerId);
      if (!token) continue;
      try {
        const first = await tables.listRows<SmsJobs>({ ...resource("sms_jobs"), queries: [Query.equal("ownerId", job.ownerId), Query.equal("status", queuedStatus), Query.orderAsc("$createdAt"), Query.limit(1)], ttl: 0 });
        if (first.rows[0]?.$id !== job.$id) continue;
        const current = await tables.getRow<SmsJobs>({ ...resource("sms_jobs"), rowId: job.$id });
        if (current.status === queuedStatus && Date.parse(current.nextAttemptAt) <= now().getTime()) { await processJob(current, token); processed++; }
      } finally { await release(job.ownerId, token); }
      if (processed) break;
    }
    return { processed };
  }
  async function getMessage(messageId: string) {
    try { return await messaging.getMessage({ messageId }); }
    catch (error) { if (missing(error)) return null; throw error; }
  }
  async function removeScheduled(messageId: string) {
    const message = await getMessage(messageId);
    if (!message) return true;
    if (!["draft", "scheduled"].includes(message.status)) return false;
    try { await messaging.delete({ messageId }); }
    catch (error) { if (await getMessage(messageId)) throw error; }
    return true;
  }
  async function reconcileOne(row: Reminders, token: string) {
    const connection = await optional<SmsConnections>("sms_connections", row.ownerId);
    const user = await users.get({ userId: row.ownerId });
    const note = row.noteId ? await optional<Notes>("notes", row.noteId) : null;
    const noteRevoked = !!row.noteId && (!note || note.ownerId !== row.ownerId || note.archived || note.completed);
    const conversation = await optional<SmsConversations>("sms_conversations", row.ownerId);
    const revoked = !user.status || !hasVerifiedBetaAccess(user, config.invitedEmails) || conversation?.smsEnabled === false || !connection || connection.targetId !== row.targetId || noteRevoked;
    const update = async (data: Partial<Reminders>) => {
      const transaction = await tables.createTransaction({ ttl: 60 });
      try {
        await fence(row.ownerId, token, transaction.$id);
        const current = await tables.getRow<Reminders>({ ...resource("reminders"), rowId: row.$id, transactionId: transaction.$id });
        if (current.ownerId !== row.ownerId || current.revision !== row.revision || current.messageId !== row.messageId || current.status !== row.status) throw new Error("Reminder intent changed");
        await tables.updateRow({ ...resource("reminders"), rowId: row.$id, data, transactionId: transaction.$id });
        await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
      } catch (error) { await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {}); throw error; }
    };
    let message = row.appliedMessageId === row.messageId ? await getMessage(row.messageId) : null;
    if (message && ["sent", "success"].includes(message.status)) {
      await update({ status: "sent", syncPending: false, lastError: row.status === "canceled" ? "already_sent" : "" }); return;
    }
    if (row.status === "canceled" || revoked) {
      // The current desired draft can exist after a crash before activation.
      let recalled = true;
      for (const messageId of new Set([row.appliedMessageId, row.messageId].filter(Boolean))) {
        if (!await removeScheduled(messageId)) recalled = false;
      }
      await update({ status: recalled ? "canceled" : "failed", syncPending: false, lastError: recalled ? "" : "already_processing" }); return;
    }
    if (row.appliedMessageId && row.appliedMessageId !== row.messageId) {
      if (!await removeScheduled(row.appliedMessageId)) {
        await update({ status: "failed", syncPending: false, lastError: "previous_already_processing" }); return;
      }
    }
    message ??= await getMessage(row.messageId);
    if (!message && Date.parse(row.remindAt) <= now().getTime() + 5000) {
      await update({ status: "failed", syncPending: false, lastError: "notification_time_passed" }); return;
    }
    if (!message) {
      await config.usage?.reserve({ ownerId: row.ownerId, operationId: row.messageId, kind: "outbound" });
      try { message = await messaging.createSMS({ messageId: row.messageId, content: row.message, targets: [row.targetId], draft: true }); }
      catch (error) { message = await getMessage(row.messageId); if (!message) throw error; }
    }
    if (!("content" in message.data) || message.data.content !== row.message || message.targets.length !== 1 || message.targets[0] !== row.targetId) throw new Error("Reminder message identity mismatch");
    if (message.status === "draft") {
      // STOP or a web deletion can race with draft creation. Re-read intent
      // and authorization immediately before scheduling. A stale worker also
      // cannot overwrite the new canceled/revised intent after its API call.
      const current = await tables.getRow<Reminders>({ ...resource("reminders"), rowId: row.$id });
      const activeConnection = await optional<SmsConnections>("sms_connections", row.ownerId);
      const lease = await tables.getRow<SmsConversations>({ ...resource("sms_conversations"), rowId: row.ownerId });
      const activeNote = row.noteId ? await optional<Notes>("notes", row.noteId) : null;
      const activeUser = await users.get({ userId: row.ownerId });
      if (current.status === "canceled" || current.messageId !== row.messageId || current.revision !== row.revision ||
        !activeUser.status || !hasVerifiedBetaAccess(activeUser, config.invitedEmails) || lease.smsEnabled === false || !activeConnection || activeConnection.targetId !== row.targetId || lease.leaseToken !== token || Date.parse(lease.leaseUntil) <= now().getTime() ||
        (row.noteId && (!activeNote || activeNote.ownerId !== row.ownerId || activeNote.archived || activeNote.completed))) {
        await removeScheduled(row.messageId); throw new Error("Reminder authorization changed");
      }
      try { message = await messaging.updateSMS({ messageId: row.messageId, draft: false, scheduledAt: row.remindAt }); }
      catch (error) { message = await getMessage(row.messageId); if (!message || message.status === "draft") throw error; }
    }
    if (message.scheduledAt && Date.parse(message.scheduledAt) !== Date.parse(row.remindAt)) throw new Error("Reminder schedule mismatch");
    const status = ["sent", "success"].includes(message.status) ? "sent" : message.status === "failed" ? "failed" : "scheduled";
    await update({ status, appliedMessageId: row.messageId, syncPending: false, lastError: status === "failed" ? "delivery_failed" : "" });
  }
  async function reconcileReminders(ownerId?: string, reminderIds?: string[]) {
    const queries = [Query.or([Query.equal("syncPending", true), Query.equal("status", "scheduled")]), Query.orderAsc("$updatedAt"), Query.limit(5)];
    if (ownerId) queries.push(Query.equal("ownerId", ownerId));
    if (reminderIds) queries.push(Query.equal("$id", reminderIds));
    const pending = await tables.listRows<Reminders>({ ...resource("reminders"), queries, ttl: 0 });
    let failures = 0;
    for (const row of pending.rows) {
      const token = await acquire(row.ownerId); if (!token) continue;
      try { await reconcileOne(await tables.getRow<Reminders>({ ...resource("reminders"), rowId: row.$id }), token); }
      catch { failures++; config.log?.("reminder_sync_retryable_failure"); }
      finally { await release(row.ownerId, token); }
    }
    return { checked: pending.rows.length, failures };
  }
  async function readyReply(receipt: SmsReceipts) {
    if (!receipt.reminderIds?.length) return receipt;
    await reconcileReminders(receipt.ownerId, receipt.reminderIds);
    const rows = await Promise.all(receipt.reminderIds.map(rowId => tables.getRow<Reminders>({ ...resource("reminders"), rowId })));
    if (rows.some(row => row.ownerId !== receipt.ownerId)) throw new Error("Reply reminder ownership mismatch");
    if (rows.some(row => row.syncPending)) return null;
    if (rows.some(row => row.status === "failed" || row.lastError === "already_sent")) {
      return await tables.updateRow<SmsReceipts>({ ...resource("sms_receipts"), rowId: receipt.$id, data: {
        reply: "I saved your changes, but couldn't confirm the reminder text. It may already be on its way. Please check with me before trying again.", reminderIds: [],
      } });
    }
    return receipt;
  }
  return { enqueue, processPending, reconcileReminders, readyReply, ensureConversation, acquire, fence, release };
}
