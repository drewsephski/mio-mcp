import { AppwriteException, ID, Permission, Query, Role } from "node-appwrite";
import type { Attachment, Note, NotesPage } from "./models";
import { attachmentContentType, listNotesSchema, noteInputSchema, resourceIdSchema, validateAttachment } from "./notes-validation.ts";

export class NotesError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "NotesError";
    this.status = status;
  }
}

export interface NotesStore {
  listNotes(queries: string[]): Promise<{ rows: Note[]; total: number }>;
  getNote(id: string): Promise<Note>;
  createNote(id: string, data: Pick<Note, "ownerId" | "title" | "body" | "archived">, permissions: string[]): Promise<Note>;
  updateNote(id: string, data: Partial<Pick<Note, "title" | "body" | "archived">>): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  listAttachments(queries: string[]): Promise<Attachment[]>;
  getAttachment(id: string): Promise<Attachment>;
  createAttachment(id: string, data: Omit<Attachment, "id" | "createdAt">, permissions: string[]): Promise<Attachment>;
  deleteAttachment(id: string): Promise<void>;
}

export interface FilesStore {
  create(id: string, file: File, permissions: string[]): Promise<void>;
  delete(id: string): Promise<void>;
  download(id: string): Promise<ArrayBuffer>;
}

function ownerPermissions(userId: string) {
  const role = Role.user(userId);
  return [Permission.read(role), Permission.update(role), Permission.delete(role)];
}

function isMissing(error: unknown) {
  return error instanceof AppwriteException && error.code === 404;
}

export function createNotesService(userId: string, store: NotesStore, files: FilesStore) {
  function assertOwner(record: { ownerId: string }) {
    if (record.ownerId !== userId) throw new NotesError("This record is unavailable.", 404);
  }

  async function getNote(id: string) {
    const note = await store.getNote(resourceIdSchema.parse(id));
    assertOwner(note);
    return note;
  }

  async function getAttachment(id: string) {
    const attachment = await store.getAttachment(resourceIdSchema.parse(id));
    assertOwner(attachment);
    await getNote(attachment.noteId);
    return attachment;
  }

  async function listAttachments(noteId: string) {
    await getNote(noteId);
    const attachments: Attachment[] = [];
    let cursor: string | undefined;
    do {
      const queries = [Query.equal("ownerId", userId), Query.equal("noteId", noteId), Query.orderAsc("$id"), Query.limit(100)];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const batch = await store.listAttachments(queries);
      for (const attachment of batch) {
        assertOwner(attachment);
        if (attachment.noteId !== noteId) throw new NotesError("Attachment does not belong to this note.", 404);
      }
      attachments.push(...batch);
      cursor = batch.length === 100 ? batch.at(-1)?.id : undefined;
    } while (cursor);
    return attachments;
  }

  async function deleteAttachment(id: string) {
    const attachment = await getAttachment(id);
    try {
      await files.delete(attachment.fileId);
    } catch (error) {
      // A retry after a partially completed deletion can safely remove metadata.
      if (!isMissing(error)) throw error;
    }
    await store.deleteAttachment(attachment.id);
    return { id: attachment.id };
  }

  return {
    getNote,
    getAttachment,
    listAttachments,
    deleteAttachment,

    async listNotes(input: unknown = {}): Promise<NotesPage> {
      const { search, archived, cursor } = listNotesSchema.parse(input);
      const queries = [Query.equal("ownerId", userId), Query.equal("archived", archived), Query.orderDesc("$updatedAt"), Query.orderDesc("$id"), Query.limit(26)];
      if (search) {
        if (search.length < 3) throw new NotesError("Use at least 3 characters to search titles.");
        queries.push(Query.search("title", search));
      }
      if (cursor) {
        const lastNote = await getNote(cursor);
        if (lastNote.archived !== archived) throw new NotesError("The list changed. Refresh your notes.");
        queries.push(Query.cursorAfter(cursor));
      }
      const result = await store.listNotes(queries);
      result.rows.forEach(assertOwner);
      const notes = result.rows.slice(0, 25);
      return { notes, total: result.total, nextCursor: result.rows.length > 25 ? notes.at(-1)!.id : null };
    },

    async createNote(input: unknown) {
      const data = noteInputSchema.parse(input);
      return store.createNote(ID.unique(), { ...data, ownerId: userId, archived: false }, ownerPermissions(userId));
    },

    async updateNote(id: string, input: unknown) {
      const data = noteInputSchema.parse(input);
      await getNote(id);
      return store.updateNote(id, data);
    },

    async setNoteArchived(id: string, archived: boolean) {
      await getNote(id);
      return store.updateNote(id, { archived });
    },

    async deleteNote(id: string) {
      await getNote(id);
      const attachments = await listAttachments(id);
      for (const attachment of attachments) {
        try {
          await deleteAttachment(attachment.id);
        } catch (error) {
          console.error("Attachment cleanup prevented note deletion", { noteId: id, attachmentId: attachment.id, error });
          throw new NotesError("Some attachments could not be deleted. Your note was kept; refresh and try again.", 503);
        }
      }
      await store.deleteNote(id);
      return { id };
    },

    async uploadAttachment(noteId: string, file: File) {
      await getNote(noteId);
      validateAttachment(file);
      const id = ID.unique();
      const fileId = ID.unique();
      const permissions = ownerPermissions(userId);
      await files.create(fileId, file, permissions);
      const data = { ownerId: userId, noteId, fileId, name: file.name, size: file.size, mimeType: attachmentContentType(file.name) };
      try {
        // Recheck the note in case it was deleted while the file was uploading.
        await getNote(noteId);
        return await store.createAttachment(id, data, permissions);
      } catch (creationError) {
        // A dropped response can mean the write succeeded. Inspect before cleanup.
        try {
          const existing = await store.getAttachment(id);
          assertOwner(existing);
          if (existing.fileId === fileId && existing.noteId === noteId) return existing;
          throw new NotesError("Upload status could not be confirmed. Refresh before uploading again.", 503);
        } catch (inspectionError) {
          if (!isMissing(inspectionError)) {
            console.error("Attachment upload status is uncertain", { attachmentId: id, fileId, creationError, inspectionError });
            throw new NotesError("Upload status could not be confirmed. Refresh before uploading again.", 503);
          }
        }
        try {
          await files.delete(fileId);
        } catch (cleanupError) {
          if (!isMissing(cleanupError)) {
            console.error("Attachment rollback failed", { fileId, creationError, cleanupError });
            throw new NotesError("The attachment could not be saved and file cleanup failed. Contact support before uploading again.", 503);
          }
        }
        throw creationError;
      }
    },

    async downloadAttachment(id: string) {
      const attachment = await getAttachment(id);
      return { attachment, content: await files.download(attachment.fileId) };
    },
  };
}
