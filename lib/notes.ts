import "server-only";
import { Storage, TablesDB } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { requireSession } from "./appwrite";
import { getResourceIds } from "./config";
import type { Attachment, Note } from "./models";
import type { Attachments as AttachmentRow, Notes as NoteRow } from "./generated/appwrite";
import { createNotesService, type NotesStore } from "./notes-service";

function toNote(row: NoteRow): Note {
  return { id: row.$id, ownerId: row.ownerId, title: row.title, body: row.body, archived: row.archived ?? false, source: row.source === "sms" ? "sms" : "web", createdAt: row.$createdAt, updatedAt: row.$updatedAt };
}

function toAttachment(row: AttachmentRow): Attachment {
  return { id: row.$id, ownerId: row.ownerId, noteId: row.noteId, fileId: row.fileId, name: row.name, size: row.size, mimeType: row.mimeType, createdAt: row.$createdAt };
}

export async function getNotesService() {
  const { client, user } = await requireSession();
  const tables = new TablesDB(client);
  const storage = new Storage(client);
  const { databaseId, notesTableId, attachmentsTableId, attachmentsBucketId } = getResourceIds();
  const notes = { databaseId, tableId: notesTableId };
  const attachments = { databaseId, tableId: attachmentsTableId };
  const store: NotesStore = {
    async listNotes(queries) {
      const result = await tables.listRows<NoteRow>({ ...notes, queries, ttl: 0 });
      return { rows: result.rows.map(toNote), total: result.total };
    },
    async getNote(rowId) { return toNote(await tables.getRow<NoteRow>({ ...notes, rowId })); },
    async createNote(rowId, data, permissions) { return toNote(await tables.createRow<NoteRow>({ ...notes, rowId, data: { ...data, source: "web", completed: false, project: "" }, permissions })); },
    async updateNote(rowId, data) { return toNote(await tables.updateRow<NoteRow>({ ...notes, rowId, data })); },
    async deleteNote(rowId) { await tables.deleteRow({ ...notes, rowId }); },
    async listAttachments(queries) {
      const result = await tables.listRows<AttachmentRow>({ ...attachments, queries, ttl: 0 });
      return result.rows.map(toAttachment);
    },
    async getAttachment(rowId) { return toAttachment(await tables.getRow<AttachmentRow>({ ...attachments, rowId })); },
    async createAttachment(rowId, data, permissions) { return toAttachment(await tables.createRow<AttachmentRow>({ ...attachments, rowId, data, permissions })); },
    async deleteAttachment(rowId) { await tables.deleteRow({ ...attachments, rowId }); },
  };
  return createNotesService(user.$id, store, {
    async create(fileId, file, permissions) {
      await storage.createFile({ bucketId: attachmentsBucketId, fileId, file: InputFile.fromBuffer(await file.arrayBuffer(), file.name), permissions });
    },
    async delete(fileId) { await storage.deleteFile({ bucketId: attachmentsBucketId, fileId }); },
    async download(fileId) { return storage.getFileDownload({ bucketId: attachmentsBucketId, fileId }); },
  });
}

export async function listNotes(input: { search?: string; archived?: boolean; cursor?: string } = {}) {
  return (await getNotesService()).listNotes(input);
}

export async function getNote(id: string) { return (await getNotesService()).getNote(id); }
export async function listAttachments(noteId: string) { return (await getNotesService()).listAttachments(noteId); }
