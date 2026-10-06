import type { Metadata } from "next";
import Link from "next/link";
import { AuthFlowForm } from "@/app/account/account-forms";
import { Brand } from "@/app/components/brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verify your email", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <section className="auth-card w-full max-w-md">
        <Brand />
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">Verify your email</h1>
        <p className="muted mb-7 mt-2 text-sm">Confirm your email address to finish setting up your account.</p>
        <AuthFlowForm mode="verify" userId={typeof params.userId === "string" ? params.userId : undefined} secret={typeof params.secret === "string" ? params.secret : undefined} />
        <Link className="text-link mt-6 inline-block text-sm" href="/dashboard">Back to your notes</Link>
      </section>
    </main>
  );
}
