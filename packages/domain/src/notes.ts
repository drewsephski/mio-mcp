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


export class InputError extends Error {}
