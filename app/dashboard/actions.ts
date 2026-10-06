"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { ActionResult, Attachment, Note, NotesPage } from "@/lib/models";
import { getActionError } from "@/lib/errors";
import { getNotesService } from "@/lib/notes";
import { archiveNoteSchema, InputError, resourceIdSchema, updateNoteSchema, validateAttachment } from "@/lib/notes-validation";

async function mutate<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await operation();
    revalidatePath("/dashboard");
    return { ok: true, data };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: getActionError(error) };
  }
}

export async function createNote(input: { title: string; body: string }): Promise<ActionResult<Note>> {
  return mutate(async () => (await getNotesService()).createNote(input));
}

export async function updateNote(input: { id: string; title: string; body: string }): Promise<ActionResult<Note>> {
  return mutate(async () => {
    const { id, ...data } = updateNoteSchema.parse(input);
    return (await getNotesService()).updateNote(id, data);
  });
}

export async function setNoteArchived(input: { id: string; archived: boolean }): Promise<ActionResult<Note>> {
  return mutate(async () => {
    const { id, archived } = archiveNoteSchema.parse(input);
    return (await getNotesService()).setNoteArchived(id, archived);
  });
}

export async function deleteNote(id: string): Promise<ActionResult<{ id: string }>> {
  return mutate(async () => (await getNotesService()).deleteNote(resourceIdSchema.parse(id)));
}

export async function uploadAttachment(formData: FormData): Promise<ActionResult<Attachment>> {
  return mutate(async () => {
    const noteId = resourceIdSchema.parse(formData.get("noteId"));
    const file = formData.get("file");
    if (!(file instanceof File)) throw new InputError("Choose a file to upload.");
    validateAttachment(file);
    return (await getNotesService()).uploadAttachment(noteId, file);
  });
}

export async function deleteAttachment(id: string): Promise<ActionResult<{ id: string }>> {
  return mutate(async () => (await getNotesService()).deleteAttachment(resourceIdSchema.parse(id)));
}

export async function refreshNotes(input: { search?: string; archived?: boolean; cursor?: string }): Promise<ActionResult<NotesPage>> {
  try { return { ok: true, data: await (await getNotesService()).listNotes(input) }; }
  catch (error) { unstable_rethrow(error); return { ok: false, error: getActionError(error) }; }
}
