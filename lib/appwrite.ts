import "server-only";
import { createNextServerHelpers } from "@appwrite.io/react/server/next";
import { AppwriteException, Client, Users } from "node-appwrite";
import { inviteEmails, hasBetaAccess } from "@/functions/mio-sms/src/beta";
import { getServerAppwriteConfig } from "./config";
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
    if (!user.status || !hasBetaAccess(user.email, inviteEmails(process.env.MIO_INVITE_EMAILS))) throw new NotesError("Mio is invite-only. Use the email address on your invitation.", 403);
    if (user.emailVerification && !user.labels.includes("mioBeta")) {
      const config = getServerAppwriteConfig();
      const users = new Users(new Client().setEndpoint(config.endpoint).setProject(config.projectId).setKey(config.apiKey));
      const current = await users.get({ userId: user.$id });
      if (!current.status || !current.emailVerification || !hasBetaAccess(current.email, inviteEmails(process.env.MIO_INVITE_EMAILS))) throw new NotesError("Verify your invited email first.", 403);
      await users.updateLabels({ userId: user.$id, labels: [...current.labels, "mioBeta"] });
    }
    return { ...session, user };
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 401) {
      throw new NotesError("Your session expired. Please sign in again.", 401);
    }
    throw error;
  }
}
