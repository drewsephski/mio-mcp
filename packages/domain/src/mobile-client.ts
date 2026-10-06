import { z } from "zod";
import { noteInputSchema, resourceIdSchema } from "./notes.ts";
import { preferencesSchema, reminderSchema, remindersPageSchema } from "./companion.ts";

const userSchema = z.object({ $id: resourceIdSchema, email: z.email(), name: z.string(), status: z.boolean(), emailVerification: z.boolean() });
const noteSchema = z.object({ $id: resourceIdSchema, ownerId: resourceIdSchema, title: z.string(), body: z.string(), archived: z.boolean().nullish(), $updatedAt: z.string() });
export type CompanionUser = z.infer<typeof userSchema>;
export type CompanionNote = z.infer<typeof noteSchema>;
export const phoneStatusSchema = z.object({ connected: z.boolean(), phone: z.string().nullable(), mioPhone: z.string().regex(/^\+[1-9]\d{7,14}$/), timezone: z.string(), defaultOffsetMinutes: z.number() });
export type PhoneStatus = z.infer<typeof phoneStatusSchema>;
type Path = "/admission" | "/status" | "/reminders" | "/reminders/update" | "/reminders/cancel" | "/preferences" | "/visit";
export class CompanionAccessError extends Error {}

// The SDK lives in the native adapter. This boundary owns validation and maps
// to existing private rows / transactional Function APIs, with no new backend.
export interface CompanionPort {
  account(): Promise<unknown>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  call(path: Path, body?: unknown, query?: Record<string, string>): Promise<unknown>;
  listNotes(ownerId: string, cursor?: string): Promise<unknown[]>;
  getNote(id: string): Promise<unknown>;
  updateNote(id: string, changes: { title: string; body: string }): Promise<unknown>;
}
export function createCompanionClient(port: CompanionPort) {
  async function session() {
    const user = userSchema.parse(await port.account());
    if (!user.status || !user.emailVerification) throw new CompanionAccessError("Verify your invited email on the web before using Mio.");
    z.object({ admitted: z.literal(true) }).parse(await port.call("/admission"));
    return user;
  }
  function owned(value: unknown, userId: string) {
    const note = noteSchema.parse(value);
    if (note.ownerId !== userId) throw new Error("That note is unavailable.");
    return note;
  }
  return {
    session,
    async signIn(email: string, password: string) {
      await port.signIn(z.email().parse(email.trim().toLowerCase()), password);
      try { return await session(); }
      catch (error) { await port.signOut().catch(() => {}); throw error; }
    },
    signOut: () => port.signOut(),
    async notes(cursor?: string) {
      const user = await session();
      const rows = await port.listNotes(user.$id, cursor ? resourceIdSchema.parse(cursor) : undefined);
      const items = rows.map(row => owned(row, user.$id));
      return { items: items.slice(0, 25), nextCursor: items.length > 25 ? items[24].$id : null };
    },
    async saveNote(id: string, input: unknown) {
      const user = await session();
      const noteId = resourceIdSchema.parse(id), changes = noteInputSchema.parse(input);
      owned(await port.getNote(noteId), user.$id);
      return owned(await port.updateNote(noteId, changes), user.$id);
    },
    async reminders(view: "upcoming" | "history" = "upcoming", cursor?: string) {
      await session();
      return remindersPageSchema.parse(await port.call("/reminders", undefined, { view, ...(cursor ? { cursor: resourceIdSchema.parse(cursor) } : {}) }));
    },
    async updateReminder(input: { id: string; revision: number; eventLocal: string; timezone: string; offsetMinutes: number; message: string }) {
      await session();
      resourceIdSchema.parse(input.id);
      return reminderSchema.parse(await port.call("/reminders/update", input));
    },
    async cancelReminder(id: string, revision: number) {
      await session();
      return reminderSchema.parse(await port.call("/reminders/cancel", { id: resourceIdSchema.parse(id), revision }));
    },
    async preferences() { await session(); return preferencesSchema.parse(await port.call("/preferences")); },
    async savePreferences(input: unknown) { await session(); return preferencesSchema.parse(await port.call("/preferences", input)); },
    async status() { await session(); return phoneStatusSchema.parse(await port.call("/status")); },
    async visit() { await session(); await port.call("/visit", { surface: "mobile" }); },
  };
}

export function messagesLink(phone: string, body = "") {
  phoneStatusSchema.shape.mioPhone.parse(phone);
  return `sms:${phone}${body ? `&body=${encodeURIComponent(body)}` : ""}`;
}
