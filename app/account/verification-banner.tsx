"use client";

import { useState, useTransition } from "react";
import { sendEmailVerification, type AccountActionResult } from "./actions";

export function VerificationBanner({ userEmail }: { userEmail: string }) {
  const [result, setResult] = useState<AccountActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <aside className="verification-notice" aria-label="Email verification">
      <div className="min-w-0 flex-1">
        <p className="verification-title">Verify your email</p>
        <p className="verification-copy">Confirm that {userEmail} belongs to you.</p>
        {result && <p className={`mt-2 text-sm ${result.ok ? "text-blue-700" : "text-red-700"}`} role={result.ok ? "status" : "alert"}>{result.message}</p>}
      </div>
      <button className="button button-secondary text-sm" type="button" disabled={pending || result?.ok} onClick={() => {
        startTransition(async () => {
          try { setResult(await sendEmailVerification()); }
          catch { setResult({ ok: false, message: "Unable to connect. Please try again." }); }
        });
      }}>{pending ? "Sending…" : result?.ok ? "Email sent" : "Send verification link"}</button>
    </aside>
  );
}
