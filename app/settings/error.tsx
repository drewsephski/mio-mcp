"use client";
import Link from "next/link";
export default function Error({ reset }: { reset: () => void }) { return <main className="auth-shell"><section className="auth-card"><h1>Settings couldn’t load.</h1><p>Refresh before making changes to your preferences.</p><div className="form-stack"><button className="button button-primary" onClick={reset}>Try again</button><Link href="/today" className="text-link">Back to Today</Link></div></section></main>; }
