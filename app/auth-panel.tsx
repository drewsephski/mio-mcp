"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useAuth } from "@appwrite.io/react";
import { useRouter } from "next/navigation";

export function AuthPanel({ initialMode = "sign-in" }: { initialMode?: "sign-in" | "sign-up" }) {
  const { user, isLoading, signIn, signUp, signOut, error } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const pending = signIn.isPending || signUp.isPending || signOut.isPending;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const onSuccess = () => { setPassword(""); router.push(mode === "sign-up" ? "/onboarding" : "/today"); router.refresh(); };
    if (mode === "sign-up") signUp.emailPassword({ email: email.trim(), password, name: name.trim() || undefined, onSuccess });
    else signIn.emailPassword({ email: email.trim(), password, onSuccess });
  }

  if (isLoading) return <p role="status" className="muted">Opening your account…</p>;
  if (user) return <div className="form-stack"><p className="muted break-words">Signed in as {user.email}</p><Link href="/today" className="button button-primary">Open Mio</Link><button className="button button-secondary" disabled={pending} onClick={() => signOut.signOut({ onSuccess: () => router.refresh() })}>{pending ? "Signing out…" : "Sign out"}</button>{error && <p className="notice notice-error" role="alert">{error.message}</p>}</div>;

  return <>
    <form onSubmit={onSubmit} aria-busy={pending}>
      <fieldset className="form-stack" disabled={pending}>
        <legend className="sr-only">{mode === "sign-up" ? "Join the beta" : "Sign in"}</legend>
        {mode === "sign-up" && <div><label className="label" htmlFor="auth-name">Your name <span className="muted">(optional)</span></label><input id="auth-name" autoComplete="name" maxLength={128} className="field" value={name} onChange={(event) => setName(event.target.value)} /></div>}
        <div><label className="label" htmlFor="auth-email">Email address</label><input id="auth-email" name="email" type="email" autoComplete="email" required maxLength={320} className="field" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
        <div><div className="password-label"><label htmlFor="auth-password" className="label">Password</label>{mode === "sign-in" && <Link href="/auth/forgot-password">Forgot password?</Link>}</div><input id="auth-password" name="password" type="password" autoComplete={mode === "sign-up" ? "new-password" : "current-password"} required minLength={mode === "sign-up" ? 8 : undefined} maxLength={256} className="field" value={password} onChange={(event) => setPassword(event.target.value)} />{mode === "sign-up" && <p className="muted mt-2 text-xs">Use at least 8 characters.</p>}</div>
        <button className="button button-primary" type="submit">{pending ? "Please wait…" : mode === "sign-up" ? "Create your account" : "Sign in"}</button>
      </fieldset>
    </form>
    {error && <p className="notice notice-error mt-4" role="alert">{error.message}</p>}
    <div className="auth-divider">{mode === "sign-up" ? "Already have an account? " : "Have a beta invitation? "}<button type="button" className="text-link" disabled={pending} onClick={() => { setMode(mode === "sign-up" ? "sign-in" : "sign-up"); setPassword(""); }}>{mode === "sign-up" ? "Sign in" : "Join the beta"}</button></div>
  </>;
}
