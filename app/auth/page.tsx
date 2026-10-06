import type { Metadata } from "next";
import Link from "next/link";
import { getAppwriteHelpers } from "@/lib/appwrite";
import { AuthPanel } from "../auth-panel";
import { Brand } from "../components/brand";

export const metadata: Metadata = { title: "Your account" };

export default async function AuthPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const [user, params] = await Promise.all([getAppwriteHelpers().getLoggedInUser(), searchParams]);
  const signUp = params.mode === "sign-up";
  return <main className="auth-shell"><header><Brand /><Link href="/" className="text-link text-xs">Back to home</Link></header><section className="auth-card"><h1>{user ? "Your account" : signUp ? "Meet your personal assistant." : "Welcome back."}</h1><p>{user ? "Your memories and reminders, all in one place." : signUp ? "Mio is invite-only. Use the email address on your beta invitation." : "Your assistant, right where you left it."}</p><AuthPanel initialMode={signUp ? "sign-up" : "sign-in"} /></section><p className="auth-caption">Your own space. Your own pace.</p></main>;
}
