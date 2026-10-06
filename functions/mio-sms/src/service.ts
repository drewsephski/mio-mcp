import { randomBytes } from "node:crypto";
import { AppwriteException, Messaging, MessagingProviderType, Permission, Query, Role, TablesDB, Users } from "node-appwrite";
import type { SmsChallenges, SmsConnections, SmsReceipts } from "./generated.ts";
import { captureText, connectionCode, digest, payloadHash, SmsError, type Inbound } from "./inbound.ts";

export function createSmsService(tables: TablesDB, users: Users, messaging: Messaging, config: { databaseId: string; providerId: string; phone: string }) {
  const resource = (tableId: string) => ({ databaseId: config.databaseId, tableId });
  const connections = resource("sms_connections");
  const challenges = resource("sms_challenges");
  const receipts = resource("sms_receipts");
  const readOnly = (ownerId: string) => [Permission.read(Role.user(ownerId))];
  const ownerPermissions = (ownerId: string) => [...readOnly(ownerId), Permission.update(Role.user(ownerId)), Permission.delete(Role.user(ownerId))];

  async function optionalRow<T extends SmsConnections | SmsReceipts>(tableId: string, rowId: string): Promise<T | null> {
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
    return { connected: !!connection, phone: connection?.phone ?? null, mioPhone: config.phone };
  }

  async function challenge(ownerId: string) {
    if (await optionalRow<SmsConnections>("sms_connections", ownerId)) throw new SmsError("Disconnect your current phone before connecting another.", 409);
    const code = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    // Rotating this one server-only row invalidates every older code.
    await tables.upsertRow({ ...challenges, rowId: ownerId, data: { tokenHash: digest(code), expiresAt }, permissions: [] });
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
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    } catch (error) {
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {});
      throw error;
    }
  }

  async function queueReply(receipt: SmsReceipts) {
    if (receipt.replyQueued) return;
    const connection = await optionalRow<SmsConnections>("sms_connections", receipt.ownerId);
    const user = await users.get({ userId: receipt.ownerId });
    if (!connection || connection.phone !== receipt.phone || connection.targetId !== receipt.targetId || !user.status) {
      // Revoked bindings must never receive pending/private confirmations.
      await tables.updateRow({ ...receipts, rowId: receipt.$id, data: { replyQueued: true } });
      return;
    }
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
    const data = { ownerId, phone: message.From, targetId, payloadHash: payloadHash(message), reply, replyQueued: false };
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
    if (!user.status) throw new SmsError("Account unavailable", 403);
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
    await commitReceipt(message, user.$id, targetId, "Connected to Mio. Text a thought and I'll save it to your private Inbox. Reply STOP to disconnect.", async (transactionId) => {
      // The delete is staged first. A rotated/consumed token conflicts at commit.
      const current = await tables.getRow<SmsChallenges>({ ...challenges, rowId: user.$id, transactionId });
      if (current.tokenHash !== token.tokenHash || new Date(current.expiresAt).getTime() <= Date.now()) throw new SmsError("Connection code expired", 409);
      await tables.deleteRow({ ...challenges, rowId: user.$id, transactionId });
      await tables.createRow({ ...connections, rowId: user.$id, data: { ownerId: user.$id, phone: message.From, targetId }, permissions: readOnly(user.$id), transactionId });
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
    const code = connectionCode(message.Body);
    if (code) return connect(message, code);
    if (/^connect\b/i.test(message.Body.trim())) return { handled: true, notice: "Copy the full connection text from Mio and send it here." };
    const connection = await byPhone(message.From);
    if (!connection) return { handled: false };
    const user = await users.get({ userId: connection.ownerId });
    if (!user.status) return { handled: true };
    const capture = captureText(message);
    const isHelp = message.OptOutType?.toUpperCase() === "HELP" || /^help$/i.test(message.Body.trim());
    const reply = isHelp ? "Mio saves your texts as private notes. Reminders and SMS search aren't available yet. Reply STOP to disconnect, or open Mio to edit your notes."
      : capture?.reply ?? "Send a text to save a note. Attachments aren't captured yet; add them in Mio.";
    await commitReceipt(message, connection.ownerId, connection.targetId, reply, async (transactionId) => {
      // Touching the binding makes a concurrent disconnect conflict with capture.
      await tables.updateRow({ ...connections, rowId: connection.$id, data: { phone: connection.phone }, transactionId });
      if (capture && !isHelp) {
        await tables.createRow({ ...resource("notes"), rowId: message.MessageSid, data: { ownerId: connection.ownerId, title: capture.title, body: capture.body, archived: false, source: "sms" }, permissions: ownerPermissions(connection.ownerId), transactionId });
      }
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

  return { status, challenge, disconnect, inbound, byPhone, retryReplies };
}
