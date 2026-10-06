"use client";
import Link from "next/link";
import { AuthShell } from "@/app/components/auth-shell";
export default function Error({ reset }: { reset: () => void }) { return <AuthShell title="Reminders couldn’t load." description="Refresh to check what Mio has scheduled."><div className="form-stack"><button className="button button-primary" onClick={reset}>Try again</button><Link href="/today" className="text-link">Back to Today</Link></div></AuthShell>; }
