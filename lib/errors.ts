import { AppwriteException } from "node-appwrite";
import { z } from "zod";
import { NotesError } from "./notes-service";
import { InputError } from "./notes-validation";

export function getActionError(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "Check your input and try again.";
  if (error instanceof NotesError) return error.message;
  if (error instanceof InputError) return error.message;
  if (error instanceof AppwriteException) {
    if (error.code === 401) return "Your session expired. Please sign in again.";
    if (error.code === 403 || error.code === 404) return "This record is unavailable.";
    if (error.code === 429) return "Too many requests. Wait a moment and try again.";
  }
  console.error("Appwrite operation failed", error);
  return "We couldn't complete that request. Refresh to check its status before trying again.";
}
