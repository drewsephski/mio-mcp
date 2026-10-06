import type { Metadata } from "next";
import Link from "next/link";
import { AuthFlowForm } from "@/app/account/account-forms";
import { AuthShell } from "@/app/components/auth-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verify your email", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <AuthShell eyebrow="Your account" title="Confirm your email." description="Verify your email address before connecting your phone to Mio.">
    <AuthFlowForm mode="verify" userId={typeof params.userId === "string" ? params.userId : undefined} secret={typeof params.secret === "string" ? params.secret : undefined} />
    <Link className="text-link auth-footer-link" href="/dashboard">Back to your notes</Link>
  </AuthShell>;
}
