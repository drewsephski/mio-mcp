export interface Note {
  id: string;
  ownerId: string;
  title: string;
  body: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  ownerId: string;
  noteId: string;
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
}

export interface NotesPage {
  notes: Note[];
  total: number;
  nextCursor: string | null;
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
