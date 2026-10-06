import type { Metadata } from "next";
import Link from "next/link";
import { AuthFlowForm } from "@/app/account/account-forms";
import { Brand } from "@/app/components/brand";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <section className="auth-card w-full max-w-md">
        <Brand />
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">Forgot your password?</h1>
        <p className="muted mb-7 mt-2 text-sm">Enter your account email and we’ll send a link to reset it.</p>
        <AuthFlowForm mode="forgot" />
        <Link className="text-link mt-6 inline-block text-sm" href="/auth">Back to sign in</Link>
      </section>
    </main>
  );
}
