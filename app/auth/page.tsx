import type { Metadata } from "next";
import { getAppwriteHelpers } from "@/lib/appwrite";
import { AuthPanel } from "../auth-panel";
import { AuthShell } from "../components/auth-shell";

export const metadata: Metadata = { title: "Your account" };

export default async function AuthPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const [user, params] = await Promise.all([getAppwriteHelpers().getLoggedInUser(), searchParams]);
  const signUp = params.mode === "sign-up";
  return <AuthShell
    eyebrow={user ? "Your account" : signUp ? "Invite-only beta" : "Welcome to Mio"}
    title={user ? "You’re signed in." : signUp ? "Create your account." : "Welcome back."}
    description={user ? "Open your notes, reminders, and conversation." : signUp ? "Create your account with the email address on your beta invitation." : "Sign in to your notes, reminders, and conversation."}
  ><AuthPanel initialMode={signUp ? "sign-up" : "sign-in"} /></AuthShell>;
}
