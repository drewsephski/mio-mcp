"use client";
import Link from "next/link";
import { AuthShell } from "@/app/components/auth-shell";

export default function DashboardError({ reset }: { reset: () => void }) {
  return <AuthShell title="Your workspace couldn’t open." description="A note may have moved, or the connection may be unavailable. Open your notes again to get a fresh view."><div className="form-stack"><Link href="/dashboard" className="button button-primary">Open my notes</Link><button className="button button-secondary" onClick={reset}>Try again</button><Link href="/auth" className="text-link">Check your account</Link></div></AuthShell>;
}
