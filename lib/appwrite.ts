import "server-only";
import { createNextServerHelpers } from "@appwrite.io/react/server/next";
import { AppwriteException } from "node-appwrite";
import { getPublicAppwriteConfig } from "./config";
import { NotesError } from "./notes-service";

export function getAppwriteHelpers() {
  return createNextServerHelpers(getPublicAppwriteConfig());
}

export async function requireSession() {
  const session = await getAppwriteHelpers().createSessionClient();
  if (!session) throw new NotesError("Please sign in to continue.", 401);

  try {
    const user = await session.account.get();
    return { ...session, user };
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 401) {
      throw new NotesError("Your session expired. Please sign in again.", 401);
    }
    throw error;
  }
}
