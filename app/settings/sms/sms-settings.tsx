"use client";

import { useEffect, useState, useTransition } from "react";
import { useAppwrite } from "@appwrite.io/react";
import { Channel } from "appwrite";
import type { SmsChallenge, SmsStatus } from "@/lib/sms";
import { createSmsConnection, disconnectSms, refreshSmsStatus } from "./actions";

export function SmsSettings({ initialStatus, ownerId, databaseId }: { databaseId: string; initialStatus: SmsStatus; ownerId: string }) {
  const { realtime } = useAppwrite();
  const [status, setStatus] = useState(initialStatus);
  const [challenge, setChallenge] = useState<SmsChallenge | null>(null);
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    async function refresh() {
      try {
        const result = await refreshSmsStatus();
        if (!disposed && result.ok) { setStatus(result.data); if (result.data.connected) setChallenge(null); }
      } catch { /* The visible Check connection button remains available. */ }
    }
    realtime.subscribe(Channel.tablesdb(databaseId).table("sms_connections").row(ownerId), () => { void refresh(); })
      .then(subscription => { if (disposed) subscription.unsubscribe(); else unsubscribe = () => { subscription.unsubscribe(); }; })
      .catch(() => { /* Settings also reconcile on focus and explicit check. */ });
    window.addEventListener("focus", refresh);
    return () => { disposed = true; unsubscribe?.(); window.removeEventListener("focus", refresh); };
  }, [databaseId, ownerId, realtime]);

  function run(action: "connect" | "disconnect" | "refresh") {
    setFeedback("");
    startTransition(async () => {
      try {
        if (action === "connect") {
          const result = await createSmsConnection();
          if (result.ok) setChallenge(result.data); else setFeedback(result.error);
        } else {
          const result = await (action === "disconnect" ? disconnectSms() : refreshSmsStatus());
          if (result.ok) { setStatus(result.data); if (action === "disconnect" || result.data.connected) setChallenge(null); if (action === "refresh" && !result.data.connected) setFeedback("Waiting for your connection text. If the code expired, generate another."); }
          else setFeedback(result.error);
        }
      } catch { setFeedback("The connection status could not be confirmed. Check it before trying again."); }
    });
  }

  const text = challenge ? `connect ${challenge.code}` : "";
  return <div className="sms-settings-content">
    <div className="sms-number"><span>Text Mio at</span><a href={`sms:${status.mioPhone}`}>{status.mioPhone}</a></div>
    <p className={`sms-connection-status ${status.connected ? "connected" : ""}`} role="status">{status.connected ? `Connected · ${status.phone}` : "Your phone isn’t connected yet."}</p>
    {status.connected ? <><p className="muted">Remember a thought, ask about your notes, or set a reminder. Follow up naturally to change it. Saved notes appear in Mio automatically.</p><p className="muted">Times use {status.timezone}. Event reminders default to {status.defaultOffsetMinutes} minutes before. Text “My timezone is America/New_York” to change your timezone.</p><button type="button" className="button button-secondary" disabled={pending} onClick={() => run("disconnect")}>Disconnect phone</button></> : <>
      <p className="muted">Connect by sending a one-time text from your phone. The code expires after 15 minutes. Keep it private: it links the sending phone to your account.</p>
      {challenge && <div className="sms-connect-instructions"><label className="label" htmlFor="sms-connect-text">Send this exact text to {challenge.mioPhone}</label><input id="sms-connect-text" className="field" readOnly value={text} onFocus={event => event.currentTarget.select()} /><div className="sms-settings-buttons"><a className="button button-primary" href={`sms:${challenge.mioPhone}?body=${encodeURIComponent(text)}`}>Open Messages</a><button type="button" className="button button-secondary" disabled={pending} onClick={() => run("refresh")}>Check connection</button></div></div>}
      <button type="button" className={`button ${challenge ? "button-quiet" : "button-primary"}`} disabled={pending} onClick={() => run("connect")}>{pending ? "Please wait…" : challenge ? "Generate a new code" : "Connect my phone"}</button>
    </>}
    {feedback && <p className="notice" role="status">{feedback}</p>}
    <div className="sms-settings-footnote"><p>Mio uses AI to understand your texts and relevant private notes. Add attachments in the app; SMS supports text only.</p><p>Reply STOP or disconnect here to stop Mio SMS and cancel pending reminders. Reply HELP for help. Message and data rates may apply. Calls to this number stay with Vapi; texts from connected phones go to Mio.</p></div>
  </div>;
}
