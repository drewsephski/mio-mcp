"use client";
import Link from "next/link";
import { AuthShell } from "@/app/components/auth-shell";
export default function Error({ reset }: { reset: () => void }) { return <AuthShell title="Your day couldn’t load." description="Refresh to get a fresh view of Mio."><div className="form-stack"><button className="button button-primary" onClick={reset}>Try again</button><Link href="/dashboard" className="text-link">Open notes</Link></div></AuthShell>; }
