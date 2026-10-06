"use client";
import Link from "next/link";
export default function Error({ reset }: { reset: () => void }) { return <main className="auth-shell"><section className="auth-card"><h1>Your day couldn’t load.</h1><p>Refresh to get a fresh view of Mio.</p><div className="form-stack"><button className="button button-primary" onClick={reset}>Try again</button><Link href="/dashboard" className="text-link">Open notes</Link></div></section></main>; }
