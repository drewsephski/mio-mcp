"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMoment, localDateTime, reminderStatus, type Reminder } from "@/lib/companion-models";
import { updateReminder, cancelReminder, type ReminderActionResult } from "./actions";

export function ReminderCard({ reminder }: { reminder: Reminder }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ReminderActionResult | null>(null);
  const [finished, setFinished] = useState(false);
  const [nearDue, setNearDue] = useState(false);
  const editable = ["pending", "scheduled"].includes(reminder.status);
  useEffect(() => {
    if (!editable) return;
    const check = () => setNearDue(Date.parse(reminder.remindAt) <= Date.now() + 60000);
    check();
    const timer = setInterval(check, 15000);
    return () => clearInterval(timer);
  }, [editable, reminder.remindAt]);
  const blocked = pending || finished || nearDue || (result?.ok === false && result.refreshRequired);
  const offset = Math.max(0, Math.round((Date.parse(reminder.eventAt) - Date.parse(reminder.remindAt)) / 60000));
  function perform(operation: () => Promise<ReminderActionResult>) {
    setResult(null);
    startTransition(async () => {
      try {
        const response = await operation();
        setResult(response);
        if (response.ok) { setEditing(false); setConfirming(false); setFinished(true); router.refresh(); }
      } catch { setResult({ ok: false, error: "The result couldn’t be confirmed. Refresh to check this reminder before making another change.", refreshRequired: true }); }
    });
  }
  const prefix = `reminder-${reminder.id}`;
  return <li className="product-reminder" data-companion-editing={editing || confirming || pending ? "true" : "false"}>
    <div className="product-reminder-heading"><div><time dateTime={reminder.remindAt}>{formatMoment(reminder.remindAt, reminder.timezone)}</time><h2>{reminder.message}</h2></div><span className={`product-status${reminder.status === "failed" ? " product-status-error" : ""}`}>{reminderStatus(reminder)}</span></div>
    <dl className="product-reminder-meta"><div><dt>Event</dt><dd>{formatMoment(reminder.eventAt, reminder.timezone)}</dd></div><div><dt>Notification</dt><dd>{offset === 0 ? "At the event time" : `${offset} minutes before`}</dd></div><div><dt>Timezone</dt><dd>{reminder.timezone}</dd></div></dl>
    {reminder.lastError && <p className="notice notice-error" role="status">{({ already_sent: "This reminder was already sent and couldn’t be recalled.", already_processing: "This text is already being processed and may still arrive.", previous_already_processing: "The previous text is already being processed. Mio did not schedule a replacement.", notification_time_passed: "The notification time passed before this text could be scheduled.", delivery_failed: "The messaging provider reported a delivery failure. This text has not been rescheduled." } as Record<string, string>)[reminder.lastError] ?? "Mio couldn’t confirm this reminder. Refresh to check its status before trying again."}</p>}
    {editable && nearDue && <p className="notice" role="status">This reminder is too close to delivery to change. Refresh to check its delivery status.</p>}
    {result?.ok === false && <div className="notice notice-error" role="alert"><p>{result.error}</p>{result.refreshRequired && <button type="button" className="button button-secondary" onClick={() => window.location.reload()}>Refresh before another change</button>}</div>}
    {result?.ok === true && <p className="notice notice-success" role="status">Your change was saved. Refreshing the schedule…</p>}
    {editing ? <form className="form-stack product-edit-form" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      perform(() => updateReminder({ id: reminder.id, revision: reminder.revision, eventLocal: String(data.get("eventLocal")), timezone: reminder.timezone, offsetMinutes: Number(data.get("offsetMinutes")), message: String(data.get("message")) }));
    }}><div><label className="label" htmlFor={`${prefix}-message`}>Reminder message</label><textarea className="field" id={`${prefix}-message`} name="message" defaultValue={reminder.message} maxLength={500} rows={2} required disabled={blocked} /></div><div className="product-fields-row"><div><label className="label" htmlFor={`${prefix}-time`}>Event date and time</label><input className="field" id={`${prefix}-time`} name="eventLocal" type="datetime-local" defaultValue={localDateTime(reminder.eventAt, reminder.timezone)} required disabled={blocked} /></div><div><label className="label" htmlFor={`${prefix}-offset`}>Minutes before</label><input className="field" id={`${prefix}-offset`} name="offsetMinutes" type="number" min={0} max={10080} step={1} defaultValue={offset} required disabled={blocked} /></div></div><p className="product-hint">Times use {reminder.timezone}. Quiet hours apply to this schedule change.</p><div className="product-button-row"><button className="button button-primary" disabled={blocked}>{pending ? "Saving…" : "Save changes"}</button><button type="button" className="button button-quiet" disabled={pending} onClick={() => setEditing(false)}>Close editor</button></div></form> : <div className="product-button-row">{reminder.noteId && <Link href={`/dashboard?note=${encodeURIComponent(reminder.noteId)}`} className="text-link">Open note</Link>}{editable && <><button className="button button-secondary" disabled={blocked} onClick={() => { setEditing(true); setConfirming(false); }}>Edit reminder</button><button className="button button-quiet" disabled={blocked} onClick={() => setConfirming(true)}>Cancel reminder</button></>}</div>}
    {confirming && <div className="product-cancel-confirm"><p>Cancel this SMS reminder? Your note will stay.</p><div className="product-button-row"><button className="button button-danger" disabled={blocked} onClick={() => perform(() => cancelReminder({ id: reminder.id, revision: reminder.revision }))}>{pending ? "Cancelling…" : "Confirm cancellation"}</button><button className="button button-secondary" disabled={pending} onClick={() => setConfirming(false)}>Keep reminder</button></div></div>}
  </li>;
}
