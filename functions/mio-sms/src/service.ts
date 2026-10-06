import { randomBytes } from "node:crypto";
import { AppwriteException, Messaging, MessagingProviderType, Permission, Query, Role, TablesDB, Users, type Models } from "node-appwrite";
import type { Reminders, SmsChallenges, SmsConnections, SmsConversations, SmsReceipts } from "./generated.ts";
import { connectionCode, digest, payloadHash, SmsError, type Inbound } from "./inbound.ts";
import { createCompanionService } from "./companion.ts";
import { hasVerifiedBetaAccess } from "./beta.ts";
import { createAssistant, type AssistantConfig } from "./assistant.ts";

export function createSmsService(tables: TablesDB, users: Users, messaging: Messaging, config: AssistantConfig & { providerId: string; phone: string; supportEmail?: string }) {
  const resource = (tableId: string) => ({ databaseId: config.databaseId, tableId });
  const connections = resource("sms_connections");
  const challenges = resource("sms_challenges");
  const receipts = resource("sms_receipts");
  const readOnly = (ownerId: string) => [Permission.read(Role.user(ownerId))];
  const assistant = createAssistant(tables, users, messaging, config);

  async function optionalRow<T extends Models.Row>(tableId: string, rowId: string): Promise<T | null> {
    try { return await tables.getRow<T>({ ...resource(tableId), rowId }); }
    catch (error) { if (error instanceof AppwriteException && error.code === 404) return null; throw error; }
  }

  async function byPhone(phone: string) {
    const result = await tables.listRows<SmsConnections>({ ...connections, queries: [Query.equal("phone", phone), Query.limit(2)], ttl: 0 });
    if (result.rows.length > 1) throw new SmsError("Ambiguous phone binding", 503);
    return result.rows[0] ?? null;
  }

  async function status(ownerId: string) {
    const connection = await optionalRow<SmsConnections>("sms_connections", ownerId);
    const conversation = await optionalRow<SmsConversations>("sms_conversations", ownerId);
    return { connected: !!connection, phone: connection?.phone ?? null, mioPhone: config.phone,
      timezone: conversation?.timezone ?? config.timezone ?? "America/Chicago", defaultOffsetMinutes: conversation?.defaultOffsetMinutes ?? config.defaultOffsetMinutes ?? 15 };
  }

  async function challenge(ownerId: string, consentVersion: string) {
    if (consentVersion !== "2026-10-06") throw new SmsError("Agree to the current SMS terms before connecting.", 400);
    const user = await users.get({ userId: ownerId });
    if (!hasVerifiedBetaAccess(user, config.invitedEmails)) throw new SmsError("Verify your invited email address before using Mio SMS.", 403);
    if (await optionalRow<SmsConnections>("sms_connections", ownerId)) throw new SmsError("Disconnect your current phone before connecting another.", 409);
    const code = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    // Rotating this one server-only row invalidates every older code.
    await tables.upsertRow({ ...challenges, rowId: ownerId, data: { tokenHash: digest(code), expiresAt, consentVersion, consentedAt: new Date().toISOString() }, permissions: [] });
    return { code, expiresAt, mioPhone: config.phone };
  }

  async function disconnect(ownerId: string) {
    // Delete the code too, so a delayed connect cannot re-enable SMS.
    const transaction = await tables.createTransaction({ ttl: 60 });
    try {
      for (const tableId of ["sms_connections", "sms_challenges"]) {
        try {
          await tables.getRow({ ...resource(tableId), rowId: ownerId, transactionId: transaction.$id });
          await tables.deleteRow({ ...resource(tableId), rowId: ownerId, transactionId: transaction.$id });
        } catch (error) { if (!(error instanceof AppwriteException && error.code === 404)) throw error; }
      }
      let cursor: string | undefined;
      do {
        const pending = await tables.listRows<Reminders>({ ...resource("reminders"), queries: [Query.equal("ownerId", ownerId), Query.equal("status", ["pending", "scheduled"]), Query.orderAsc("$id"), Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])], transactionId: transaction.$id, ttl: 0 });
        for (const reminder of pending.rows) {
          if (reminder.ownerId !== ownerId) throw new SmsError("Reminder ownership mismatch", 503);
          await tables.updateRow({ ...resource("reminders"), rowId: reminder.$id, data: { status: "canceled", syncPending: true }, transactionId: transaction.$id });
        }
        cursor = pending.rows.length === 100 ? pending.rows.at(-1)?.$id : undefined;
      } while (cursor);
      try {
        await tables.getRow({ ...resource("sms_conversations"), rowId: ownerId, transactionId: transaction.$id });
        await tables.updateRow({ ...resource("sms_conversations"), rowId: ownerId, data: { smsEnabled: false, leaseToken: `revoked_${randomBytes(12).toString("hex")}`, leaseUntil: new Date(0).toISOString() }, transactionId: transaction.$id });
      } catch (error) { if (!(error instanceof AppwriteException && error.code === 404)) throw error; }
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    } catch (error) {
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {});
      throw error;
    }
    // Cancel every outstanding native schedule now, rather than leaving all
    // but the first five for subsequent minute workers. Failed recalls retain
    // syncPending and remain recoverable by the normal durable reconciler.
    let cursor: string | undefined;
    do {
      const canceled = await tables.listRows<Reminders>({ ...resource("reminders"), queries: [Query.equal("ownerId", ownerId), Query.equal("status", "canceled"), Query.equal("syncPending", true), Query.orderAsc("$id"), Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])], ttl: 0 });
      for (let index = 0; index < canceled.rows.length; index += 5) {
        await assistant.reconcileReminders(ownerId, canceled.rows.slice(index, index + 5).map(row => row.$id));
      }
      cursor = canceled.rows.length === 100 ? canceled.rows.at(-1)?.$id : undefined;
    } while (cursor);
  }

  async function queueReply(receipt: SmsReceipts) {
    if (receipt.replyQueued) return;
    if (receipt.deliveryMode === "draft" && !config.verificationMode) return;
    const connection = await optionalRow<SmsConnections>("sms_connections", receipt.ownerId);
    const user = await users.get({ userId: receipt.ownerId });
    const preferences = await optionalRow<SmsConversations>("sms_conversations", receipt.ownerId);
    if (preferences?.smsEnabled === false || !connection || !hasVerifiedBetaAccess(user, config.invitedEmails) || connection.phone !== receipt.phone || connection.targetId !== receipt.targetId || !user.status) {
      // Revoked bindings must never receive pending/private confirmations.
      await tables.updateRow({ ...receipts, rowId: receipt.$id, data: { replyQueued: true } });
      return;
    }
    const needsRecheck = !!receipt.reminderIds?.length;
    const ready = await assistant.readyReply(receipt);
    if (!ready) return;
    receipt = ready;
    if (needsRecheck) {
      const current = await optionalRow<SmsConnections>("sms_connections", receipt.ownerId);
      const currentUser = await users.get({ userId: receipt.ownerId });
      const currentPreferences = await optionalRow<SmsConversations>("sms_conversations", receipt.ownerId);
      if (currentPreferences?.smsEnabled === false || !hasVerifiedBetaAccess(currentUser, config.invitedEmails) || !current || current.phone !== receipt.phone || current.targetId !== receipt.targetId || !currentUser.status) {
        await tables.updateRow({ ...receipts, rowId: receipt.$id, data: { replyQueued: true } }); return;
      }
    }
    await config.usage?.reserve({ ownerId: receipt.ownerId, operationId: receipt.$id, kind: "outbound" });
    try {
      await messaging.createSMS({ messageId: receipt.$id, content: receipt.reply, targets: [receipt.targetId] });
    } catch (error) {
      // An ambiguous write is always inspected; the same ID is never replaced.
      const existing = await messaging.getMessage({ messageId: receipt.$id }).catch((inspectionError: unknown) => {
        if (inspectionError instanceof AppwriteException && inspectionError.code === 404) throw error;
        throw inspectionError;
      });
      if (!("content" in existing.data) || existing.data.content !== receipt.reply || existing.targets.length !== 1 || existing.targets[0] !== receipt.targetId) {
        throw new SmsError("Confirmation identity mismatch", 503);
      }
    }
    await tables.updateRow({ ...receipts, rowId: receipt.$id, data: { replyQueued: true } });
  }

  async function commitReceipt(message: Inbound, ownerId: string, targetId: string, reply: string, stage: (transactionId: string) => Promise<void>) {
    const data = { ownerId, phone: message.From, targetId, payloadHash: payloadHash(message), reply, replyQueued: false, deliveryMode: config.verificationMode ? "draft" : "live" };
    const transaction = await tables.createTransaction({ ttl: 60 });
    try {
      await stage(transaction.$id);
      await tables.createRow({ ...receipts, rowId: message.MessageSid, data, permissions: [], transactionId: transaction.$id });
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    } catch (error) {
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {});
      // Commit may have succeeded even when its response was lost, or a
      // concurrent delivery may have won. Inspect the durable receipt.
      const existing = await optionalRow<SmsReceipts>("sms_receipts", message.MessageSid);
      if (!existing) throw error;
      if (existing.payloadHash !== data.payloadHash) throw new SmsError("Message identity mismatch", 409);
    }
    const receipt = await tables.getRow<SmsReceipts>({ ...receipts, rowId: message.MessageSid });
    await queueReply(receipt);
  }

  async function connect(message: Inbound, code: string) {
    const result = await tables.listRows<SmsChallenges>({ ...challenges, queries: [Query.equal("tokenHash", digest(code)), Query.limit(1)], ttl: 0 });
    const token = result.rows[0];
    if (!token || new Date(token.expiresAt).getTime() <= Date.now()) return { handled: true, notice: "That code has expired or been replaced. Send the current connection text from Mio." };
    const user = await users.get({ userId: token.$id });
    if (!user.status || !hasVerifiedBetaAccess(user, config.invitedEmails)) throw new SmsError("Verify your invited email address before using Mio SMS.", 403);
    if (token.consentVersion !== "2026-10-06" || !token.consentedAt) return { handled: true, notice: "Open Mio and agree to the SMS terms to get a fresh connection text." };
    if (await byPhone(message.From) || await optionalRow<SmsConnections>("sms_connections", user.$id)) {
      return { handled: true, notice: "This phone or account is already connected. Disconnect it in Mio first." };
    }
    let targetId = `sms_${digest(`${user.$id}:${message.From}`).slice(0, 32)}`;
    try {
      await users.createTarget({ userId: user.$id, targetId, providerType: MessagingProviderType.Sms, identifier: message.From, providerId: config.providerId, name: "Mio SMS Inbox" });
    } catch (error) {
      if (!(error instanceof AppwriteException && error.code === 409)) throw error;
      // Appwrite also rejects an identifier already used by another target.
      // Reuse only an exact target owned by this verified account; never move
      // a target from another user or send private replies through it.
      const existing = await users.listTargets({ userId: user.$id, queries: [
        Query.equal("identifier", message.From), Query.equal("providerType", MessagingProviderType.Sms),
        Query.equal("providerId", config.providerId), Query.limit(2),
      ] });
      if (existing.targets.length !== 1) return { handled: true, notice: "Mio couldn't connect this phone. Check your existing Mio account or try a different phone." };
      targetId = existing.targets[0].$id;
    }
    await commitReceipt(message, user.$id, targetId, "Connected to Mio. Text thoughts, questions, or reminders. Message frequency varies. Msg & data rates may apply. Reply STOP to stop, HELP for help.", async (transactionId) => {
      // The delete is staged first. A rotated/consumed token conflicts at commit.
      const current = await tables.getRow<SmsChallenges>({ ...challenges, rowId: user.$id, transactionId });
      if (current.tokenHash !== token.tokenHash || new Date(current.expiresAt).getTime() <= Date.now()) throw new SmsError("Connection code expired", 409);
      await tables.deleteRow({ ...challenges, rowId: user.$id, transactionId });
      const conversation = await optionalRow<SmsConversations>("sms_conversations", user.$id);
      if (conversation) await tables.updateRow({ ...resource("sms_conversations"), rowId: user.$id, data: { smsEnabled: true }, transactionId });
      await tables.createRow({ ...connections, rowId: user.$id, data: { ownerId: user.$id, phone: message.From, targetId, consentVersion: token.consentVersion, consentedAt: token.consentedAt }, permissions: readOnly(user.$id), transactionId });
    });
    return { handled: true };
  }

  async function inbound(message: Inbound) {
    const previous = await optionalRow<SmsReceipts>("sms_receipts", message.MessageSid);
    if (previous) {
      if (previous.payloadHash !== payloadHash(message)) throw new SmsError("Message identity mismatch", 409);
      await queueReply(previous);
      return { handled: true };
    }
    const bound = await byPhone(message.From);
    await config.usage?.reserve({ ownerId: bound?.ownerId ?? `anon_${digest(message.From).slice(0, 30)}`, operationId: message.MessageSid, kind: "inbound" });
    const code = connectionCode(message.Body);
    if (code) return connect(message, code);
    if (/^connect\b/i.test(message.Body.trim())) return { handled: true, notice: "Copy the full connection text from Mio and send it here." };
    const connection = await byPhone(message.From);
    if (!connection) return { handled: false };
    const user = await users.get({ userId: connection.ownerId });
    const conversation = await optionalRow<SmsConversations>("sms_conversations", user.$id);
    if (!user.status || !hasVerifiedBetaAccess(user, config.invitedEmails) || conversation?.smsEnabled === false) return { handled: true };
    const isHelp = message.OptOutType?.toUpperCase() === "HELP" || /^help$/i.test(message.Body.trim());
    if (!isHelp && message.Body.trim()) {
      await assistant.enqueue(message, connection);
      return { handled: true };
    }
    const reply = isHelp ? `Mio help: text thoughts, questions, or reminders. Support: ${config.supportEmail ?? "drewsepeczi@gmail.com"}. Reply STOP to stop. Msg & data rates may apply.`
      : "Send a text with your request. Add attachments in Mio; I can only read text here.";
    await commitReceipt(message, connection.ownerId, connection.targetId, reply, async (transactionId) => {
      // Touching the binding makes a concurrent disconnect conflict with capture.
      await tables.updateRow({ ...connections, rowId: connection.$id, data: { phone: connection.phone }, transactionId });
    });
    return { handled: true };
  }

  async function retryReplies() {
    const pending = await tables.listRows<SmsReceipts>({ ...receipts, queries: [Query.equal("replyQueued", false), Query.orderAsc("$createdAt"), Query.limit(5)], ttl: 0 });
    let failures = 0;
    for (const receipt of pending.rows) {
      try { await queueReply(receipt); } catch { failures++; }
    }
    return { attempted: pending.rows.length, failures };
  }

  async function work(ownerId?: string) {
    const reminders = await assistant.reconcileReminders(ownerId);
    const jobs = await assistant.processPending(ownerId);
    const replies = await retryReplies();
    return { ...jobs, reminderFailures: reminders.failures, replyFailures: replies.failures };
  }
  const companion = createCompanionService(tables, users, assistant, config, { disconnect });
  return { status, challenge, disconnect, inbound, byPhone, retryReplies, work, companion };
}
