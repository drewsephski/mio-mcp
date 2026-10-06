"use client";

import { LoadingButton } from "@/app/components/loading-button";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { z } from "zod";
import { requestPasswordRecovery, resetPassword, verifyEmail, type AccountActionResult } from "./actions";

type AuthFlowFormProps =
  | { mode: "forgot" }
  | { mode: "reset" | "verify"; userId?: string; secret?: string };

const tokenSchema = z.object({
  userId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/),
  secret: z.string().min(1).max(4096).regex(/^[^\s\u0000-\u001f\u007f]+$/),
});
const passwordSchema = z.object({
  password: z.string().min(8).max(256),
  confirmation: z.string(),
}).refine((value) => value.password === value.confirmation);

export function AuthFlowForm(props: AuthFlowFormProps) {
  const [result, setResult] = useState<AccountActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const validToken = props.mode === "forgot" || tokenSchema.safeParse({ userId: props.userId, secret: props.secret }).success;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || result?.ok) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    if (props.mode === "forgot" && !z.email().max(320).safeParse(String(data.get("email") ?? "").trim()).success) {
      setResult({ ok: false, message: "Enter a valid email address." });
      return;
    }
    if (props.mode === "reset" && !passwordSchema.safeParse({ password: data.get("password"), confirmation: data.get("confirmation") }).success) {
      setResult({ ok: false, message: "Use matching passwords between 8 and 256 characters." });
      return;
    }
    startTransition(async () => {
      try {
        const response = props.mode === "forgot"
          ? await requestPasswordRecovery(data)
          : props.mode === "reset" ? await resetPassword(data) : await verifyEmail(data);
        setResult(response);
        if (response.ok) {
          form.reset();
          if (props.mode !== "forgot") window.history.replaceState(null, "", window.location.pathname);
        }
      } catch {
        setResult({ ok: false, message: "Unable to connect. Check your connection and try again." });
      }
    });
  }

  if (!validToken) {
    return (
      <div className="form-stack">
        <p className="notice notice-error" role="alert">This link is incomplete. Open the full link from your email, or request a new one.</p>
        <Link className="button button-primary" href={props.mode === "reset" ? "/auth/forgot-password" : "/onboarding"}>{props.mode === "reset" ? "Request a reset link" : "Open email verification"}</Link>
      </div>
    );
  }

  return (
    <div className="form-stack">
      {!result?.ok && (
        <form className="form-stack" onSubmit={onSubmit} aria-busy={pending}>
          {props.mode !== "forgot" && <><input type="hidden" name="userId" value={props.userId} /><input type="hidden" name="secret" value={props.secret} /></>}
          {props.mode === "forgot" && (
            <div>
              <label className="label" htmlFor="recovery-email">Email address</label>
              <input className="field" id="recovery-email" name="email" type="email" autoComplete="email" maxLength={320} required disabled={pending} />
            </div>
          )}
          {props.mode === "reset" && (
            <>
              <div>
                <label className="label" htmlFor="new-password">New password</label>
                <input className="field" id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={256} required disabled={pending} aria-describedby="password-guidance" />
                <p className="muted mt-2 text-xs" id="password-guidance">At least 8 characters. Use a password you haven’t used before.</p>
              </div>
              <div>
                <label className="label" htmlFor="confirm-password">Confirm password</label>
                <input className="field" id="confirm-password" name="confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={256} required disabled={pending} />
              </div>
            </>
          )}
          <LoadingButton loading={pending} className="button button-primary w-full" type="submit" disabled={pending}>{props.mode === "forgot" ? "Send reset link" : props.mode === "reset" ? "Update password" : "Verify email address"}</LoadingButton>
        </form>
      )}
      {result && <p className={`notice ${result.ok ? "notice-success" : "notice-error"}`} role={result.ok ? "status" : "alert"}>{result.message}</p>}
      {result?.ok && <Link className="button button-primary w-full" href={props.mode === "verify" ? "/onboarding" : "/auth"}>{props.mode === "verify" ? "Continue to Mio" : "Back to sign in"}</Link>}
    </div>
  );
}
