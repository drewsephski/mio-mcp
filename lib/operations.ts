import "server-only";
import { getAppwriteHelpers } from "./appwrite";
import { isOperator } from "@/functions/mio-sms/src/operator-auth";
import { NotesError } from "./notes-service";
export async function requireOperator() {
  const user = await getAppwriteHelpers().getLoggedInUser();
  if (!user) throw new NotesError("Sign in to continue.", 401);
  if (!isOperator(user, process.env.MIO_OPERATOR_USER_ID)) throw new NotesError("Forbidden", 403);
  return user;
}
