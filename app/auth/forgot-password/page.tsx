import type { Metadata } from "next";
import Link from "next/link";
import { AuthFlowForm } from "@/app/account/account-forms";
import { AuthShell } from "@/app/components/auth-shell";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function ForgotPasswordPage() {
  return <AuthShell eyebrow="Your account" title="Reset your password." description="Enter your account email. We’ll send you a link to choose a new password.">
    <AuthFlowForm mode="forgot" />
    <Link className="text-link auth-footer-link" href="/auth">Back to sign in</Link>
  </AuthShell>;
}
