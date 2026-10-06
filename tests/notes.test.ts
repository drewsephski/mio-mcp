import assert from "node:assert/strict";
import { test } from "node:test";
import { AppwriteException } from "node-appwrite";
import { createNotesService, type FilesStore, type NotesStore } from "../lib/notes-service.ts";
import type { Attachment, Note } from "../lib/models";
import { downloadDisposition, noteInputSchema, resourceIdSchema, validateAttachment } from "../lib/notes-validation.ts";

const note: Note = { id: "note1", ownerId: "alice", title: "A note", body: "Private", archived: false, createdAt: "2026-10-06", updatedAt: "2026-10-06" };
const attachment: Attachment = { id: "attachment1", ownerId: "alice", noteId: "note1", fileId: "file1", name: "example.txt", size: 5, mimeType: "text/plain", createdAt: "2026-10-06" };

function fixture() {
  const calls: Array<{ operation: string; data?: unknown }> = [];
  const missing = () => new AppwriteException("Not found", 404);
  const store: NotesStore = {
    async listNotes(queries) { calls.push({ operation: "listNotes", data: queries }); return { rows: [note], total: 1 }; },
    async getNote() { return note; },
    async createNote(id, data, permissions) { calls.push({ operation: "createNote", data: { data, permissions } }); return { ...note, ...data, id }; },
    async updateNote(id, data) { calls.push({ operation: "updateNote", data }); return { ...note, ...data, id }; },
    async deleteNote() { calls.push({ operation: "deleteNote" }); },
    async listAttachments() { return [attachment]; },
    async getAttachment(id) { if (id === attachment.id) return attachment; throw missing(); },
    async createAttachment(id, data, permissions) { calls.push({ operation: "createAttachment", data: permissions }); return { ...data, id, createdAt: "2026-10-06" }; },
    async deleteAttachment() { calls.push({ operation: "deleteAttachment" }); },
  };
  const files: FilesStore = {
    async create(id, file, permissions) { calls.push({ operation: "upload", data: { id, name: file.name, permissions } }); },
    async delete(id) { calls.push({ operation: "deleteFile", data: id }); },
    async download(id) { calls.push({ operation: "download", data: id }); return new ArrayBuffer(0); },
  };
  return { calls, store, files, service: createNotesService("alice", store, files) };
}

test("note validation rejects blank titles, excessive content, and forged ownership", () => {
  assert.equal(noteInputSchema.parse({ title: "  Title  ", body: "Body" }).title, "Title");
  for (const input of [{ title: " ", body: "" }, { title: "Title", body: "x".repeat(100_001) }, { title: "Title", body: "", ownerId: "bob" }]) {
    assert.equal(noteInputSchema.safeParse(input).success, false);
  }
});

test("resource IDs reject empty values, unsafe characters, and values beyond provider limits", () => {
  for (const value of ["", "../notes", "notes/table", "-invalid", "a".repeat(37)]) {
    assert.equal(resourceIdSchema.safeParse(value).success, false);
  }
  for (const value of ["mio", "68d143bf001b9a793c30", "a".repeat(36), "note.with-dash_under"]) {
    assert.equal(resourceIdSchema.safeParse(value).success, true);
  }
});

test("create derives ownership and grants only owner access", async () => {
  const { service, calls } = fixture();
  const result = await service.createNote({ title: "Title", body: "" });
  assert.equal(result.ownerId, "alice");
  assert.deepEqual(calls[0].data, { data: { title: "Title", body: "", ownerId: "alice", archived: false }, permissions: ['read("user:alice")', 'update("user:alice")', 'delete("user:alice")'] });
});

test("second account cannot read, modify, archive, delete, or attach to another user's note", async () => {
  const { store, files, calls } = fixture();
  const bob = createNotesService("bob", store, files);
  const operations = [() => bob.getNote("note1"), () => bob.updateNote("note1", { title: "Hijacked", body: "" }), () => bob.setNoteArchived("note1", true), () => bob.deleteNote("note1"), () => bob.listAttachments("note1"), () => bob.uploadAttachment("note1", new File(["hello"], "a.txt")), () => bob.deleteAttachment("attachment1"), () => bob.downloadAttachment("attachment1")];
  for (const operation of operations) await assert.rejects(operation, /unavailable/);
  assert.deepEqual(calls, []);
});

test("attachment must belong to an owned note even if attachment owner matches", async () => {
  const { store, service, calls } = fixture();
  store.getNote = async () => ({ ...note, ownerId: "bob" });
  await assert.rejects(() => service.downloadAttachment("attachment1"), /unavailable/);
  await assert.rejects(() => service.deleteAttachment("attachment1"), /unavailable/);
  assert.deepEqual(calls, []);
});

test("note queries include owner, archive status, title search, and cursor pagination", async () => {
  const { service, calls } = fixture();
  await service.listNotes({ search: "Private", archived: false, cursor: "note1" });
  const queries = calls[0].data as string[];
  const parsed = queries.map((query) => JSON.parse(query) as { method: string; attribute?: string; values?: unknown[] });
  assert.ok(parsed.some((query) => query.method === "equal" && query.attribute === "ownerId" && query.values?.[0] === "alice"));
  assert.ok(parsed.some((query) => query.method === "equal" && query.attribute === "archived" && query.values?.[0] === false));
  assert.ok(parsed.some((query) => query.method === "search" && query.attribute === "title"));
  assert.ok(parsed.some((query) => query.method === "cursorAfter"));
  await assert.rejects(() => service.listNotes({ search: "a" }), /at least 3/);
});

test("cursor ownership is checked before querying and archive changes invalidate old cursor", async () => {
  const { store, files, service, calls } = fixture();
  const bob = createNotesService("bob", store, files);
  await assert.rejects(() => bob.listNotes({ cursor: "note1" }), /unavailable/);
  await assert.rejects(() => service.listNotes({ cursor: "note1", archived: true }), /list changed/);
  assert.deepEqual(calls, []);
});

test("rollback removes uploaded file when metadata write failed and absence is confirmed", async () => {
  const { service, store, calls } = fixture();
  store.createAttachment = async () => { throw new Error("Create failed"); };
  await assert.rejects(() => service.uploadAttachment("note1", new File(["hello"], "a.txt")), /Create failed/);
  assert.deepEqual(calls.map((call) => call.operation), ["upload", "deleteFile"]);
});

test("lost metadata response is reconciled without replaying mutation or deleting file", async () => {
  const { service, store, calls } = fixture();
  let created: Attachment | undefined;
  store.createAttachment = async (id, data) => {
    created = { ...data, id, createdAt: "2026-10-06" };
    throw new Error("Connection dropped");
  };
  store.getAttachment = async () => {
    assert.ok(created);
    return created;
  };
  const result = await service.uploadAttachment("note1", new File(["hello"], "a.txt"));
  assert.equal(result.id, created?.id);
  assert.deepEqual(calls.map((call) => call.operation), ["upload"]);
});

test("uncertain metadata status retains file and tells caller to refresh", async (context) => {
  const { service, store, calls } = fixture();
  context.mock.method(console, "error", () => {});
  store.createAttachment = async () => { throw new Error("Connection dropped"); };
  store.getAttachment = async () => { throw new Error("Still offline"); };
  await assert.rejects(() => service.uploadAttachment("note1", new File(["hello"], "a.txt")), /Refresh before uploading again/);
  assert.deepEqual(calls.map((call) => call.operation), ["upload"]);
});

test("pagination shows 25 notes and a cursor only when another note exists", async () => {
  const { service, store } = fixture();
  store.listNotes = async () => ({ rows: Array.from({ length: 26 }, (_, index) => ({ ...note, id: `note${index}` })), total: 26 });
  const first = await service.listNotes();
  assert.equal(first.notes.length, 25);
  assert.equal(first.nextCursor, "note24");
  store.listNotes = async () => ({ rows: [note], total: 1 });
  assert.equal((await service.listNotes()).nextCursor, null);
});

test("note stays intact when attachment cleanup fails", async (context) => {
  const { service, files, calls } = fixture();
  context.mock.method(console, "error", () => {});
  files.delete = async () => { throw new Error("Unavailable"); };
  await assert.rejects(() => service.deleteNote("note1"), /Your note was kept/);
  assert.equal(calls.some((call) => call.operation === "deleteNote"), false);
});

test("deletion recovers when file already removed, then deletes metadata before note", async () => {
  const { service, files, calls } = fixture();
  files.delete = async () => { throw new AppwriteException("Missing file", 404); };
  await service.deleteNote("note1");
  assert.deepEqual(calls.map((call) => call.operation), ["deleteAttachment", "deleteNote"]);
});

test("uploads reject unsafe filenames and unsupported types; download headers resist injection", () => {
  for (const file of [new File(["hello"], "script.html"), new File(["hello"], "../a.txt"), new File(["hello"], "a\r\n.txt"), new File([], "empty.txt")]) assert.throws(() => validateAttachment(file));
  validateAttachment(new File(["hello"], "notes.md"));
  const disposition = downloadDisposition('résumé"\r\n.txt');
  assert.equal(/[\r\n]/.test(disposition), false);
  assert.match(disposition, /filename\*=UTF-8''/);
});
