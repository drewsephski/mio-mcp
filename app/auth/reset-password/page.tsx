import type { Metadata } from "next";
import Link from "next/link";
import { AuthFlowForm } from "@/app/account/account-forms";
import { AuthShell } from "@/app/components/auth-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <AuthShell eyebrow="Your account" title="Choose a new password." description="Use at least 8 characters and a password you haven’t used before.">
    <AuthFlowForm mode="reset" userId={typeof params.userId === "string" ? params.userId : undefined} secret={typeof params.secret === "string" ? params.secret : undefined} />
    <Link className="text-link auth-footer-link" href="/auth">Back to sign in</Link>
  </AuthShell>;
}
