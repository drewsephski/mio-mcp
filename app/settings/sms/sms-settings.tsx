"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useAppwrite } from "@appwrite.io/react";
import { Channel } from "appwrite";
import { Check, MessageSquare } from "lucide-react";
import type { SmsChallenge, SmsStatus } from "@/lib/sms";
import { createSmsConnection, disconnectSms, refreshSmsStatus } from "./actions";

function messageLink(phone: string, body = "") {
  const separator = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent) ? "&" : "?";
  return `sms:${phone}${body ? `${separator}body=${encodeURIComponent(body)}` : ""}`;
}

export function SmsSettings({ initialStatus, ownerId, databaseId, onboarding = false }: { databaseId: string; initialStatus: SmsStatus; ownerId: string; onboarding?: boolean }) {
  const { realtime } = useAppwrite();
  const [status, setStatus] = useState(initialStatus);
  const [challenge, setChallenge] = useState<SmsChallenge | null>(null);
  const [consent, setConsent] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    async function refresh() {
      try {
        const result = await refreshSmsStatus();
        if (!disposed && result.ok) { setStatus(result.data); if (result.data.connected) setChallenge(null); }
      } catch { /* Explicit check and focus remain available. */ }
    }
    realtime.subscribe(Channel.tablesdb(databaseId).table("sms_connections").row(ownerId), () => { void refresh(); })
      .then(subscription => { if (disposed) subscription.unsubscribe(); else unsubscribe = () => subscription.unsubscribe(); })
      .catch(() => { /* Focus and bounded polling also reconcile connection. */ });
    const timer = challenge ? window.setInterval(() => {
      if (Date.now() >= Date.parse(challenge.expiresAt)) { setChallenge(null); setFeedback("Your connection text expired. Open Messages again to prepare a fresh one."); return; }
      void refresh();
    }, 5000) : undefined;
    window.addEventListener("focus", refresh);
    return () => { disposed = true; unsubscribe?.(); if (timer) window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [challenge, databaseId, ownerId, realtime]);

  function run(action: "connect" | "disconnect" | "refresh") {
    setFeedback("");
    startTransition(async () => {
      try {
        if (action === "connect") {
          const result = await createSmsConnection(consent);
          if (result.ok) { setChallenge(result.data); window.location.href = messageLink(result.data.mioPhone, `CONNECT ${result.data.code}`); }
          else setFeedback(result.error);
        } else {
          const result = await (action === "disconnect" ? disconnectSms() : refreshSmsStatus());
          if (result.ok) {
            setStatus(result.data);
            if (action === "disconnect" || result.data.connected) setChallenge(null);
            if (action === "refresh" && !result.data.connected) setFeedback("Waiting for your connection text. Tap Send in Messages, then check again.");
          } else setFeedback(result.error);
        }
      } catch { setFeedback("The connection status could not be confirmed. Check it before trying again."); }
    });
  }

  return <div className="sms-settings-content">
    {status.connected ? <>
      <div className="connection-success" role="status"><Check aria-hidden="true" /><div><h2>You’re connected.</h2><p>{status.phone}</p></div></div>
      <p className="muted">Try texting Mio:</p>
      <blockquote className="onboarding-example">“Remind me tomorrow at 10 to check my application.”</blockquote>
      <a className="button button-primary" href={messageLink(status.mioPhone)}><MessageSquare size={16} aria-hidden="true" />Text Mio</a>
      <p className="muted">Times use {status.timezone}. Event reminders default to {status.defaultOffsetMinutes} minutes before. <Link className="text-link" href="/settings">Manage preferences</Link></p>
      {onboarding ? <Link className="button button-secondary" href="/today">Open Today</Link> : <button type="button" className="button button-secondary" disabled={pending} onClick={() => run("disconnect")}>Disconnect and cancel pending reminders</button>}
    </> : <>
      <p className="muted">Send a one-time text from your phone to link it to your private account. We’ll open Messages with everything filled in. You just tap Send.</p>
      <label className="sms-consent"><input type="checkbox" checked={consent} disabled={pending || !!challenge} onChange={event => setConsent(event.target.checked)} /><span>I agree to receive transactional assistant replies and requested reminder messages from Mio. Message frequency varies. Message and data rates may apply. Reply STOP to stop or HELP for help. Consent is optional; web notes remain available. <Link href="/sms-terms" className="text-link">SMS terms</Link>, <Link href="/terms" className="text-link">Terms</Link> and <Link href="/privacy" className="text-link">Privacy Policy</Link>.</span></label>
      {challenge ? <div className="sms-connect-instructions">
        <a className="button button-primary" href={messageLink(challenge.mioPhone, `CONNECT ${challenge.code}`)}><MessageSquare size={16} aria-hidden="true" />Open Messages</a>
        <p className="muted text-xs mt-3" role="status">Waiting for your connection text… Your code expires in 15 minutes.</p>
        <div className="sms-settings-buttons"><button type="button" className="button button-secondary" disabled={pending} onClick={() => run("refresh")}>Check connection</button><button type="button" className="button button-quiet" disabled={pending} onClick={() => run("connect")}>Get a fresh connection text</button></div>
        <details className="sms-fallback"><summary>Messages didn’t open?</summary><label className="label" htmlFor="sms-connect-text">Send this exact text to {challenge.mioPhone}</label><input id="sms-connect-text" className="field" readOnly value={`CONNECT ${challenge.code}`} onFocus={event => event.currentTarget.select()} /><p className="muted text-xs mt-2">Keep this code private: it links the sending phone to your account.</p></details>
      </div> : <button type="button" className="button button-primary" disabled={pending || !consent} onClick={() => run("connect")}><MessageSquare size={16} aria-hidden="true" />{pending ? "Preparing your text…" : "Open Messages"}</button>}
      {onboarding && <Link href="/today" className="text-link text-xs">I’ll connect later</Link>}
    </>}
    {feedback && <p className="notice" role="status">{feedback}</p>}
    <div className="sms-settings-footnote"><p>Mio uses AI to understand your texts and relevant private notes. Add attachments in the app; SMS supports text only.</p><p>Reply STOP or disconnect in Settings to stop Mio SMS and cancel pending reminders. Reply HELP for help.</p></div>
  </div>;
}
