import "server-only";
import { redirect } from "next/navigation";
import { getAppwriteHelpers } from "./appwrite";
import { hasBetaAccess, inviteEmails } from "../functions/mio-sms/src/beta";

export async function requireBetaPage(verified = true) {
  const user = await getAppwriteHelpers().getLoggedInUser();
  if (!user) redirect("/auth");
  if (!user.status || !hasBetaAccess(user.email, inviteEmails(process.env.MIO_INVITE_EMAILS))) redirect("/beta-access");
  if (verified && !user.emailVerification) redirect("/onboarding");
  return user;
}
