import { AppwriteException, Query, type Models, type TablesDB, type Users } from "node-appwrite";
import { z } from "zod";
import type { createAssistant } from "./assistant.ts";
import type { Notes, Reminders, SmsConnections, SmsConversations, SmsTurns } from "./generated.ts";
import { SmsError } from "./inbound.ts";
import { assertOutsideQuietHours, parsePreferences } from "./preferences.ts";
import { localTimeSchema, reminderTimes, timezoneSchema } from "./time.ts";
import { scheduledMessageId } from "./tools.ts";

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,35}$/);
const pageSchema = z.object({ cursor: id.optional() }).strict();
const reminderPageSchema = pageSchema.extend({ view: z.enum(["upcoming", "history"]).default("upcoming") });
const revisionSchema = z.object({ id, revision: z.number().int().positive() }).strict();
const updateSchema = revisionSchema.extend({ eventLocal: localTimeSchema, timezone: timezoneSchema.optional(),
  offsetMinutes: z.number().int().min(0).max(10080).optional(), remindLocal: localTimeSchema.optional(),
  message: z.string().trim().min(1).max(500).optional() });
const clock = z.union([z.literal(""), z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)]);
const preferencesSchema = z.object({ timezone: timezoneSchema.optional(), defaultOffsetMinutes: z.number().int().min(0).max(10080).optional(),
  quietHoursStart: clock.optional(), quietHoursEnd: clock.optional(), smsEnabled: z.boolean().optional(),
  proactiveMessagesEnabled: z.literal(false).optional(), dailyDigestEnabled: z.literal(false).optional(),
}).strict().refine(value => Object.keys(value).length > 0, "Supply a preference to save");

export type ReminderView = Pick<Reminders, "noteId" | "eventAt" | "remindAt" | "timezone" | "message" | "status" | "revision" | "syncPending" | "lastError"> & { id: string };
export type ActivityView = { id: string; createdAt: string; userText: string; reply: string; notes: { id: string; title: string }[]; reminderIds: string[] };
type Assistant = ReturnType<typeof createAssistant>;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SmsError(result.error.issues[0]?.message ?? "Invalid request", 400);
  return result.data;
}
function reminderView(row: Reminders): ReminderView {
  return { id: row.$id, noteId: row.noteId, eventAt: row.eventAt, remindAt: row.remindAt, timezone: row.timezone,
    message: row.message, status: row.status, revision: row.revision, syncPending: row.syncPending, lastError: row.lastError };
}

// All owner IDs come from the authenticated Appwrite session in main.ts.
// Reminder intent shares the assistant's fenced lease; only reconciliation
// communicates with Messaging, preserving durable retries and read-only rows.
export function createCompanionService(tables: TablesDB, users: Users, assistant: Assistant,
  config: { databaseId: string; now?: () => Date }, callbacks: { disconnect(ownerId: string): Promise<void> }) {
  const resource = (tableId: string) => ({ databaseId: config.databaseId, tableId });
  const now = config.now ?? (() => new Date());
  async function optional<T extends Models.Row>(tableId: string, rowId: string, transactionId?: string): Promise<T | null> {
    try { return await tables.getRow<T>({ ...resource(tableId), rowId, transactionId }); }
    catch (error) { if (error instanceof AppwriteException && error.code === 404) return null; throw error; }
  }
  function owned<T extends { ownerId: string }>(row: T | null, ownerId: string): T {
    if (!row || row.ownerId !== ownerId) throw new SmsError("That item is unavailable", 404);
    return row;
  }
  async function assertCursor(tableId: string, cursor: string | undefined, ownerId: string) {
    if (cursor) owned(await optional<Reminders | SmsTurns>(tableId, cursor), ownerId);
  }
  async function assertAccount(ownerId: string) {
    if (!(await users.get({ userId: ownerId })).status) throw new SmsError("Account unavailable", 403);
  }
  async function reminders(ownerId: string, input: unknown = {}) {
    const { view, cursor } = parse(reminderPageSchema, input);
    await assertCursor("reminders", cursor, ownerId);
    const queries = [Query.equal("ownerId", ownerId), Query.equal("status", view === "upcoming" ? ["pending", "scheduled"] : ["sent", "canceled", "failed"]),
      view === "upcoming" ? Query.orderAsc("remindAt") : Query.orderDesc("remindAt"), Query.orderAsc("$id")];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    queries.push(Query.limit(26));
    const rows = (await tables.listRows<Reminders>({ ...resource("reminders"), queries, ttl: 0 })).rows;
    rows.forEach(row => owned(row, ownerId));
    return { items: rows.slice(0, 25).map(reminderView), nextCursor: rows.length > 25 ? rows[24].$id : null };
  }
  async function activity(ownerId: string, input: unknown = {}) {
    const { cursor } = parse(pageSchema, input);
    await assertCursor("sms_turns", cursor, ownerId);
    const queries = [Query.equal("ownerId", ownerId), Query.orderDesc("$createdAt"), Query.orderDesc("$id")];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    queries.push(Query.limit(26));
    const rows = (await tables.listRows<SmsTurns>({ ...resource("sms_turns"), queries, ttl: 0 })).rows;
    rows.forEach(row => owned(row, ownerId));
    const page = rows.slice(0, 25), noteIds = [...new Set(page.flatMap(turn => turn.noteIds))];
    const notes = new Map<string, string>();
    // Each turn can reference ten notes. Chunk IDs so a full activity page
    // stays below Appwrite's per-query size limit even with 36-character IDs.
    for (let start = 0; start < noteIds.length; start += 50) {
      const result = await tables.listRows<Notes>({ ...resource("notes"), queries: [Query.equal("ownerId", ownerId), Query.equal("$id", noteIds.slice(start, start + 50)), Query.limit(50)], ttl: 0 });
      for (const row of result.rows) { owned(row, ownerId); notes.set(row.$id, row.title); }
    }
    const items: ActivityView[] = page.map(row => ({ id: row.$id, createdAt: row.$createdAt, userText: row.userText, reply: row.reply,
      notes: row.noteIds.filter(noteId => notes.has(noteId)).map(noteId => ({ id: noteId, title: notes.get(noteId)! })), reminderIds: row.reminderIds }));
    return { items, nextCursor: rows.length > 25 ? rows[24].$id : null };
  }
  async function preferences(ownerId: string) {
    await assistant.ensureConversation(ownerId);
    const row = owned(await optional<SmsConversations>("sms_conversations", ownerId), ownerId);
    const connection = await optional<SmsConnections>("sms_connections", ownerId);
    if (connection) owned(connection, ownerId);
    return { ...parsePreferences(row), smsEnabled: !!connection && parsePreferences(row).smsEnabled };
  }
  async function locked<T>(ownerId: string, operation: (token: string) => Promise<T>): Promise<T> {
    await assertAccount(ownerId);
    const token = await assistant.acquire(ownerId);
    if (!token) throw new SmsError("Mio is finishing another request. Try again in a moment.", 409);
    try { return await operation(token); }
    finally { await assistant.release(ownerId, token); }
  }
  async function savePreferences(ownerId: string, input: unknown) {
    const changes = parse(preferencesSchema, input);
    await locked(ownerId, async token => {
      const transaction = await tables.createTransaction({ ttl: 60 });
      try {
        const current = owned(await assistant.fence(ownerId, token, transaction.$id), ownerId);
        const next = { ...parsePreferences(current), ...changes };
        if (!!next.quietHoursStart !== !!next.quietHoursEnd || next.quietHoursStart && next.quietHoursStart === next.quietHoursEnd) {
          throw new SmsError("Set both quiet hours, with different start and end times", 400);
        }
        if (changes.smsEnabled === true) {
          const connection = await optional<SmsConnections>("sms_connections", ownerId, transaction.$id);
          if (!connection || connection.ownerId !== ownerId) throw new SmsError("Connect your phone to enable SMS", 409);
          await tables.updateRow({ ...resource("sms_connections"), rowId: ownerId, data: { phone: connection.phone }, transactionId: transaction.$id });
        }
        await tables.updateRow({ ...resource("sms_conversations"), rowId: ownerId, data: changes, transactionId: transaction.$id });
        await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
      } catch (error) {
        await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {});
        const persisted = await optional<SmsConversations>("sms_conversations", ownerId);
        if (!persisted || persisted.ownerId !== ownerId || !Object.entries(changes).every(([key, value]) => persisted[key as keyof SmsConversations] === value)) throw error;
      }
    });
    // Disconnection revokes leases and atomically cancels outstanding intent.
    // Perform it after releasing our lease so its reconciliation can acquire it.
    if (changes.smsEnabled === false) await callbacks.disconnect(ownerId);
    return preferences(ownerId);
  }
  async function mutateReminder(ownerId: string, reminderId: string, revision: number, change: (row: Reminders, conversation: SmsConversations) => Partial<Reminders>) {
    await locked(ownerId, async token => {
      const transaction = await tables.createTransaction({ ttl: 60 });
      let staged: Partial<Reminders> | undefined;
      try {
        const conversation = owned(await assistant.fence(ownerId, token, transaction.$id), ownerId);
        const row = owned(await optional<Reminders>("reminders", reminderId, transaction.$id), ownerId);
        if (row.revision !== revision) throw new SmsError("This reminder changed. Refresh it before editing.", 409);
        if (!["pending", "scheduled"].includes(row.status)) throw new SmsError("This reminder is no longer editable", 409);
        if (Date.parse(row.remindAt) <= now().getTime() + 60_000) throw new SmsError("This text is already due or may be on its way", 409);
        const connection = owned(await optional<SmsConnections>("sms_connections", ownerId, transaction.$id), ownerId);
        if (connection.targetId !== row.targetId || !parsePreferences(conversation).smsEnabled) throw new SmsError("Connect your phone before changing reminders", 409);
        await tables.updateRow({ ...resource("sms_connections"), rowId: ownerId, data: { phone: connection.phone }, transactionId: transaction.$id });
        staged = change(row, conversation);
        await tables.updateRow({ ...resource("reminders"), rowId: row.$id, data: staged, transactionId: transaction.$id });
        await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
      } catch (error) {
        await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {});
        // Resolve a lost commit response by inspecting this precise revision;
        // never replay a mutation with an unknown commit outcome.
        const persisted = staged ? await optional<Reminders>("reminders", reminderId) : null;
        if (!persisted || persisted.ownerId !== ownerId || !staged || !Object.entries(staged).every(([key, value]) => persisted[key as keyof Reminders] === value)) throw error;
      }
    });
    await assistant.reconcileReminders(ownerId, [reminderId]);
    return reminderView(owned(await optional<Reminders>("reminders", reminderId), ownerId));
  }
  async function updateReminder(ownerId: string, input: unknown) {
    const request = parse(updateSchema, input);
    return mutateReminder(ownerId, request.id, request.revision, (row, conversation) => {
      const timezone = request.timezone ?? row.timezone;
      const offset = request.offsetMinutes ?? Math.round((Date.parse(row.eventAt) - Date.parse(row.remindAt)) / 60_000);
      let times;
      try { times = reminderTimes(request.eventLocal, timezone, offset, request.remindLocal); }
      catch { throw new SmsError("That local time is invalid or ambiguous during daylight saving. Choose another time.", 400); }
      if (Date.parse(times.remindAt) <= now().getTime() + 60_000) throw new SmsError("Choose a notification time at least one minute in the future", 400);
      try { assertOutsideQuietHours(times.remindAt, conversation.timezone, parsePreferences(conversation)); }
      catch { throw new SmsError("That notification falls within your quiet hours. Choose another time.", 400); }
      const revision = row.revision + 1;
      return { ...times, timezone, message: request.message ?? row.message, revision, messageId: scheduledMessageId(row.$id, revision),
        syncPending: true, status: "pending", lastError: "" };
    });
  }
  async function cancelReminder(ownerId: string, input: unknown) {
    const request = parse(revisionSchema, input);
    return mutateReminder(ownerId, request.id, request.revision, row => ({ revision: row.revision + 1, status: "canceled", syncPending: true, lastError: "" }));
  }
  return { reminders, activity, preferences, savePreferences, updateReminder, cancelReminder };
}
