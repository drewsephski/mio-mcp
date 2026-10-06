import { z } from "zod";

export const resourceIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/, "Invalid record ID.");
export const noteInputSchema = z.object({
  title: z.string().trim().min(1, "Give your note a title.").max(255, "Keep the title under 256 characters."),
  body: z.string().max(100_000, "Keep the note under 100,001 characters."),
}).strict();
export const updateNoteSchema = noteInputSchema.extend({ id: resourceIdSchema });
export const archiveNoteSchema = z.object({ id: resourceIdSchema, archived: z.boolean() }).strict();
export const listNotesSchema = z.object({
  search: z.string().trim().max(255).optional(),
  archived: z.boolean().optional().default(false),
  cursor: resourceIdSchema.optional(),
}).strict();

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const ATTACHMENT_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp", "txt", "md"] as const;

export class InputError extends Error {}

export function validateAttachment(file: File) {
  if (!file.size) throw new InputError("Choose a file with content.");
  if (file.size > MAX_ATTACHMENT_SIZE) throw new InputError("Choose a file smaller than 10 MB.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!ATTACHMENT_EXTENSIONS.some((allowed) => allowed === extension)) {
    throw new InputError("Choose a PDF, PNG, JPG, WebP, TXT, or Markdown file.");
  }
  if (file.name.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(file.name)) {
    throw new InputError("Choose a file with a valid name under 256 characters.");
  }
}

export function attachmentContentType(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", txt: "text/plain", md: "text/markdown" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

export function downloadDisposition(name: string) {
  const fallback = name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 255) || "attachment";
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
