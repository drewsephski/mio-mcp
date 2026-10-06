"use client";
import Link from "next/link";

export default function DashboardError({ reset }: { reset: () => void }) {
  return <main className="auth-shell"><section className="auth-card"><h1>Your workspace couldn’t open.</h1><p>A note may have moved, or the connection may be unavailable. Open your notes again to get a fresh view.</p><div className="form-stack"><Link href="/dashboard" className="button button-primary">Open my notes</Link><button className="button button-secondary" onClick={reset}>Try again</button><Link href="/auth" className="text-link">Check your account</Link></div></section></main>;
}
