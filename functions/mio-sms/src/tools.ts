import { tool, type ToolSet } from "ai";
import type { Outcome } from "./outcomes.ts";
import { AppwriteException, Permission, Query, Role, type TablesDB } from "node-appwrite";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import type { Attachments, Notes, Reminders } from "./generated.ts";
import { digest } from "./inbound.ts";
import { assertOutsideQuietHours } from "./preferences.ts";
import type { UsageLimits } from "./usage.ts";
import { localTimeSchema, reminderTimes, timezoneSchema } from "./time.ts";

class ToolError extends Error {}
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,35}$/);
const noteFields = z.object({ title: z.string().trim().min(1).max(255).optional(), body: z.string().max(16000).optional(),
  project: z.string().max(128).optional(), completed: z.boolean().optional() }).strict();
const timing = { eventLocal: localTimeSchema, offsetMinutes: z.number().int().min(0).max(10080).optional(), remindLocal: localTimeSchema.optional() };
export const scheduledMessageId = (reminderId: string, revision: number) => `m_${digest(`${reminderId}:${revision}`).slice(0, 32)}`;

export function createMioTools(tables: TablesDB, options: {
  databaseId: string; ownerId: string; targetId: string; turnId: string; transactionId: string;
  timezone: string; defaultOffsetMinutes: number; now: Date; signal: AbortSignal;
  text: string; referenceNoteIds: string[];
  preferences?: { quietHoursStart?: string | null; quietHoursEnd?: string | null };
  limits?: Pick<UsageLimits, "maxActiveReminders" | "maxScheduledOutbound">;
}) {
  const resource = (tableId: string) => ({ databaseId: options.databaseId, tableId, transactionId: options.transactionId });
  const permissions = [Permission.read(Role.user(options.ownerId)), Permission.update(Role.user(options.ownerId)), Permission.delete(Role.user(options.ownerId))];
  const readOnly = [Permission.read(Role.user(options.ownerId))];
  const seenNotes = new Set<string>(), seenReminders = new Set<string>();
  const fullNotes = new Set<string>();
  const noteIds = new Set<string>(), reminderIds = new Set<string>();
  const outcomes = new Set<Outcome>();
  let sequence = 0, calls = 0, mutations = 0, deleted = false;
  let fatal: unknown;
  let tail: Promise<unknown> = Promise.resolve();
  function owned<T extends { ownerId: string }>(row: T): T {
    if (row.ownerId !== options.ownerId) throw new ToolError("That item is unavailable");
    return row;
  }
  async function getNote(noteId: string) {
    const row = owned(await tables.getRow<Notes>({ ...resource("notes"), rowId: noteId }));
    seenNotes.add(noteId); return row;
  }
  async function getReminder(reminderId: string) {
    const row = owned(await tables.getRow<Reminders>({ ...resource("reminders"), rowId: reminderId }));
    seenReminders.add(reminderId); return row;
  }
  function noteView(row: Notes, full = false) {
    owned(row); seenNotes.add(row.$id); noteIds.add(row.$id);
    if (full || row.body.length <= 4000) fullNotes.add(row.$id);
    const limit = full ? 16000 : 4000;
    return { id: row.$id, title: row.title, body: row.body.slice(0, limit), bodyTruncated: row.body.length > limit, project: row.project, completed: row.completed, archived: row.archived };
  }
  function reminderView(row: Reminders) {
    owned(row); seenReminders.add(row.$id); reminderIds.add(row.$id);
    return { id: row.$id, noteId: row.noteId, eventAt: row.eventAt, remindAt: row.remindAt, timezone: row.timezone, message: row.message, status: row.status };
  }
  function requireRead(set: Set<string>, value: string) {
    if (!set.has(value)) throw new ToolError("Read or search for the exact item before changing it");
  }
  function editable(row: Reminders) {
    if (!["pending", "scheduled"].includes(row.status)) throw new ToolError("That reminder has already been sent, canceled, or could not be scheduled");
    if (Date.parse(row.remindAt) <= options.now.getTime() + 60_000) throw new ToolError("That text is already due or may be on its way; it cannot safely be changed");
  }
  function future(eventLocal: string, offsetMinutes: number, remindLocal?: string) {
    let times;
    try { times = reminderTimes(eventLocal, options.timezone, offsetMinutes, remindLocal); }
    catch { throw new ToolError("That local time is invalid or ambiguous during daylight saving; choose another time"); }
    if (Date.parse(times.remindAt) <= options.now.getTime() + 60_000) throw new ToolError("Choose a notification time at least one minute in the future");
    try { assertOutsideQuietHours(times.remindAt, options.timezone, options.preferences ?? {}); }
    catch (error) { throw new ToolError(error instanceof Error ? error.message : "Choose a time outside quiet hours"); }
    return times;
  }
  async function cancelLinked(noteId: string) {
    const rows = await tables.listRows<Reminders>({ ...resource("reminders"), queries: [Query.equal("ownerId", options.ownerId), Query.equal("noteId", noteId), Query.equal("status", ["pending", "scheduled"]), Query.limit(11)], ttl: 0 });
    if (rows.rows.length > 10) throw new ToolError("Too many linked reminders; manage them individually first");
    rows.rows.forEach(row => editable(owned(row)));
    for (const row of rows.rows) {
      await tables.updateRow({ ...resource("reminders"), rowId: row.$id, data: { status: "canceled", syncPending: true } });
      reminderIds.add(row.$id); outcomes.add("canceled_reminder");
    }
  }
  async function assertDeleteReference(noteId: string, reference: string) {
    const normalized = reference.toLowerCase().replace(/[^\p{L}\p{N}: ]/gu, " ").replace(/\s+/g, " ").trim();
    const text = options.text.toLowerCase().replace(/[^\p{L}\p{N}: ]/gu, " ").replace(/\s+/g, " ");
    if (!normalized || !text.includes(normalized)) throw new ToolError("Quote the user's actual target words; do not invent a selection");
    if (/^(that|it|this)( (note|idea|one))?$/.test(normalized)) {
      const references = [...new Set(options.referenceNoteIds)];
      if (references.length !== 1 || references[0] !== noteId) throw new ToolError("Several or no recent notes could be meant; ask which note");
      return;
    }
    const words = normalized.split(" ").filter(word => word.length >= 3 && !["the", "note", "notes", "idea", "please", "delete", "remove", "that", "this"].includes(word));
    if (!words.length) throw new ToolError("Ask which note the user means");
    const result = await tables.listRows<Notes>({ ...resource("notes"), queries: [Query.equal("ownerId", options.ownerId), Query.equal("archived", false),
      ...words.slice(0, 5).map(word => Query.or([Query.search("title", word), Query.search("body", word)])), Query.limit(3)], ttl: 0 });
    result.rows.forEach(owned);
    if (result.total !== 1 || result.rows[0]?.$id !== noteId) {
      throw new ToolError(`Ask which note: ${result.rows.map(row => row.title).join(" or ") || "no unique match"}`);
    }
  }
  // AI SDK can execute parallel tool calls. Serialize them and bound both
  // reads and writes; all side effects are staged in the SAME turn transaction.
  function define<S extends z.ZodType>(description: string, inputSchema: S, execute: (input: z.output<S>) => Promise<unknown>, writes = false, outcome?: Outcome) {
    return tool({ description, inputSchema, execute: (input) => {
      const run = tail.then(async () => {
        options.signal.throwIfAborted();
        if (fatal) throw fatal;
        if (++calls > 20 || (writes && ++mutations > 8)) throw new ToolError("This turn has too many actions; split the request");
        try {
          const result = await execute(inputSchema.parse(input));
          if (outcome) outcomes.add(outcome);
          else if (!writes) outcomes.add("answered");
          return result;
        }
        catch (error) {
          if (error instanceof ToolError) { outcomes.add("clarification"); if (outcome === "created_reminder" || outcome === "updated_reminder") outcomes.add("reminder_rejected"); return { error: error.message }; }
          if (error instanceof AppwriteException && error.code === 404) return { error: "That item is unavailable" };
          // Do not let SDK tool-error handling turn an infrastructure failure
          // into a partially committed turn, or leak API errors to the model.
          fatal = new Error("Tool storage unavailable"); throw fatal;
        }
      });
      tail = run.catch(() => {}); return run;
    } });
  }
  const tools: ToolSet = {
    askClarification: define("Request clarification when the target, date, or intent is ambiguous. This performs no mutation. Then ask one short question in your reply.", z.object({ reason: z.enum(["target", "time", "intent"]) }).strict(), async () => ({ clarificationRequired: true }), false, "clarification"),
    createNote: define("Store a useful thought. Do not use for corrections or questions.", z.object({ title: z.string().trim().min(1).max(255), body: z.string().min(1).max(16000), project: z.string().max(128).optional() }).strict(), async input => {
      const rowId = `n_${digest(`${options.turnId}:${sequence++}`).slice(0, 32)}`;
      return noteView(await tables.createRow<Notes>({ ...resource("notes"), rowId, data: { ...input, project: input.project ?? "", ownerId: options.ownerId, source: "sms", archived: false, completed: false }, permissions }));
    }, true, "created_note"),
    getNote: define("Read one exact note, including before editing a conversational reference. Never replace a truncated body.", z.object({ noteId: id }).strict(), async ({ noteId }) => noteView(await getNote(noteId), true)),
    listRecentNotes: define("Read up to eight most recently changed active notes.", z.object({}).strict(), async () => {
      const result = await tables.listRows<Notes>({ ...resource("notes"), queries: [Query.equal("ownerId", options.ownerId), Query.equal("archived", false), Query.orderDesc("$updatedAt"), Query.limit(8)], ttl: 0 });
      return result.rows.map(row => noteView(row));
    }),
    searchNotes: define("Retrieve notes matching a natural query. Use a few distinctive keywords, not a whole question. Multiple matches require clarification before destruction.", z.object({ query: z.string().trim().min(3).max(120), includeArchived: z.boolean().optional() }).strict(), async ({ query, includeArchived }) => {
      const words = query.match(/[\p{L}\p{N}]+/gu)?.filter(word => word.length >= 3).slice(0, 5) ?? [];
      if (!words.length) throw new ToolError("Search with a word of at least three characters");
      const queries = [Query.equal("ownerId", options.ownerId), Query.or(words.flatMap(word => [Query.search("title", word), Query.search("body", word)])), Query.orderDesc("$updatedAt"), Query.limit(8)];
      if (!includeArchived) queries.push(Query.equal("archived", false));
      const result = await tables.listRows<Notes>({ ...resource("notes"), queries, ttl: 0 });
      return { notes: result.rows.map(row => noteView(row)), more: result.total > result.rows.length };
    }),
    updateNote: define("Update explicit fields on one exact previously read note. Use completed=true to mark done.", z.object({ noteId: id, changes: noteFields.refine(fields => Object.keys(fields).length > 0) }).strict(), async ({ noteId, changes }) => {
      requireRead(seenNotes, noteId); const current = await getNote(noteId);
      if (changes.body !== undefined && (!fullNotes.has(noteId) || current.body.length > 16000)) throw new ToolError("Read the complete note before replacing its body; very long notes must be edited in Mio");
      if (changes.completed) await cancelLinked(noteId);
      return noteView(await tables.updateRow<Notes>({ ...resource("notes"), rowId: noteId, data: changes }));
    }, true, "updated_note"),
    archiveNote: define("Archive one previously read note and cancel its pending reminders.", z.object({ noteId: id }).strict(), async ({ noteId }) => {
      requireRead(seenNotes, noteId); await getNote(noteId); await cancelLinked(noteId);
      return noteView(await tables.updateRow<Notes>({ ...resource("notes"), rowId: noteId, data: { archived: true } }));
    }, true, "archived_note"),
    deleteNote: define("Delete ONE unambiguous previously read note. reference must quote the target words from the current SMS (e.g. 'work', 'that note'). Named references are checked against all owned candidates; pronouns require one recent note. Never bulk delete.", z.object({ noteId: id, reference: z.string().trim().min(1).max(120) }).strict(), async ({ noteId, reference }) => {
      requireRead(seenNotes, noteId); await getNote(noteId);
      await assertDeleteReference(noteId, reference);
      if (deleted) throw new ToolError("Only one note may be deleted per text");
      const attachments = await tables.listRows<Attachments>({ ...resource("attachments"), queries: [Query.equal("ownerId", options.ownerId), Query.equal("noteId", noteId), Query.limit(1)], ttl: 0 });
      if (attachments.rows.length) throw new ToolError("This note has attachments; archive it or delete it in Mio");
      await cancelLinked(noteId);
      await tables.deleteRow({ ...resource("notes"), rowId: noteId }); deleted = true; noteIds.add(noteId);
      return { deleted: true };
    }, true, "deleted_note"),
    createReminder: define("Create a requested SMS reminder, optionally linked to a note. Separate local event time from notification offset/time. Returns UTC times for precise confirmation.", z.object({ ...timing, noteId: id.optional(), message: z.string().trim().min(1).max(500) }).strict(), async input => {
      if (input.noteId) { requireRead(seenNotes, input.noteId); await getNote(input.noteId); }
      if (options.limits) {
        const active = await tables.listRows<Reminders>({ ...resource("reminders"), queries: [Query.equal("ownerId", options.ownerId), Query.equal("status", ["pending", "scheduled"]), Query.limit(1)], ttl: 0 });
        if (active.total >= Math.min(options.limits.maxActiveReminders, options.limits.maxScheduledOutbound)) throw new ToolError("You have reached your active reminder limit. Cancel a reminder before adding another.");
      }
      const times = future(input.eventLocal, input.offsetMinutes ?? options.defaultOffsetMinutes, input.remindLocal);
      const rowId = `r_${digest(`${options.turnId}:${sequence++}`).slice(0, 32)}`;
      return reminderView(await tables.createRow<Reminders>({ ...resource("reminders"), rowId, data: {
        ...times, ownerId: options.ownerId, noteId: input.noteId ?? "", timezone: options.timezone, message: input.message,
        status: "pending", revision: 1, messageId: scheduledMessageId(rowId, 1), appliedMessageId: "", targetId: options.targetId, syncPending: true, lastError: "",
      }, permissions: readOnly }));
    }, true, "created_reminder"),
    getReminder: define("Read one exact reminder before changing it; eventAt/remindAt are UTC instants.", z.object({ reminderId: id }).strict(), async ({ reminderId }) => reminderView(await getReminder(reminderId))),
    listUpcomingReminders: define("Retrieve up to ten active reminders, optionally for an exact note or a local calendar day.", z.object({ noteId: id.optional(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(), async ({ noteId, day }) => {
      const queries = [Query.equal("ownerId", options.ownerId), Query.equal("status", ["pending", "scheduled"]), Query.orderAsc("remindAt"), Query.limit(10)];
      if (noteId) queries.push(Query.equal("noteId", noteId));
      if (day) {
        const start = Temporal.PlainDate.from(day).toZonedDateTime(options.timezone);
        const end = start.add({ days: 1 });
        queries.push(Query.greaterThanEqual("eventAt", start.toInstant().toString()), Query.lessThan("eventAt", end.toInstant().toString()));
      } else queries.push(Query.greaterThanEqual("eventAt", options.now.toISOString()));
      const result = await tables.listRows<Reminders>({ ...resource("reminders"), queries, ttl: 0 });
      return result.rows.map(reminderView);
    }),
    updateReminder: define("Reschedule a previously read active reminder. For a time correction pass only eventTime (HH:mm); its existing date is preserved. Only supply eventDate when the user explicitly changes the DAY, and quote their date words in dateReference. Preserve offset if omitted. Update the linked note if its event changes.", z.object({ reminderId: id,
      eventTime: z.string().regex(/^\d{2}:\d{2}$/).optional(), eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), dateReference: z.string().trim().min(1).max(120).optional(),
      offsetMinutes: timing.offsetMinutes, remindLocal: timing.remindLocal, message: z.string().trim().min(1).max(500).optional() }).strict().refine(input => !input.eventDate || !!input.dateReference, "Quote the user's day-change words when changing the date"), async input => {
      requireRead(seenReminders, input.reminderId);
      const row = await getReminder(input.reminderId); editable(row);
      const local = new Intl.DateTimeFormat("sv-SE", { timeZone: options.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(row.eventAt)).replace(" ", "T");
      if (input.eventDate && !options.text.toLowerCase().includes(input.dateReference!.toLowerCase())) throw new ToolError("Only change the date when quoting an explicit day change from the current text");
      const offset = input.offsetMinutes ?? Math.round((Date.parse(row.eventAt) - Date.parse(row.remindAt)) / 60000);
      const eventLocal = `${input.eventDate ?? local.slice(0, 10)}T${input.eventTime ?? local.slice(11, 16)}`;
      const times = future(eventLocal, offset, input.remindLocal);
      const revision = row.revision + 1;
      return reminderView(await tables.updateRow<Reminders>({ ...resource("reminders"), rowId: row.$id, data: { ...times, timezone: options.timezone, message: input.message ?? row.message, revision, messageId: scheduledMessageId(row.$id, revision), syncPending: true, status: "pending", lastError: "" } }));
    }, true, "updated_reminder"),
    cancelReminder: define("Cancel one previously read reminder. Already-sent reminders cannot be recalled.", z.object({ reminderId: id }).strict(), async ({ reminderId }) => {
      requireRead(seenReminders, reminderId); const row = await getReminder(reminderId); editable(row);
      return reminderView(await tables.updateRow<Reminders>({ ...resource("reminders"), rowId: reminderId, data: { status: "canceled", syncPending: true } }));
    }, true, "canceled_reminder"),
    setTimezone: define("Save an explicitly supplied IANA timezone for future turns. Ask user to resend time requests after changing timezone.", z.object({ timezone: timezoneSchema }).strict(), async ({ timezone }) => {
      await tables.updateRow({ ...resource("sms_conversations"), rowId: options.ownerId, data: { timezone } });
      return { timezone, appliesFromNextTurn: true };
    }, true),
  };
  return { tools, noteIds, reminderIds, outcomes, async assertHealthy() { await tail; if (fatal) throw fatal; options.signal.throwIfAborted(); } };
}
