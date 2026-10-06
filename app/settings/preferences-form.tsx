"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Preferences } from "@/lib/companion-models";
import { savePreferences, type PreferencesResult } from "./actions";

export function PreferencesForm({ preferences }: { preferences: Preferences }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PreferencesResult | null>(null);
  const [dirty, setDirty] = useState(false);
  const blocked = pending || (result?.ok === false && result.refreshRequired);
  return <form className="form-stack product-preferences" data-companion-editing={dirty || pending ? "true" : "false"} onChange={() => setDirty(true)} onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setResult(null);
    startTransition(async () => {
      try {
        const response = await savePreferences({ timezone: String(form.get("timezone")), defaultOffsetMinutes: Number(form.get("defaultOffsetMinutes")), quietHoursStart: String(form.get("quietHoursStart")), quietHoursEnd: String(form.get("quietHoursEnd")) });
        setResult(response);
        if (response.ok) { setDirty(false); router.refresh(); }
      } catch { setResult({ ok: false, error: "The save couldn’t be confirmed. Refresh to check your preferences before saving again.", refreshRequired: true }); }
    });
  }}>
    <div><label htmlFor="timezone" className="label">Timezone</label><input id="timezone" name="timezone" className="field" list="timezones" defaultValue={preferences.timezone} maxLength={100} required disabled={blocked} aria-describedby="timezone-hint" /><datalist id="timezones">{["America/Chicago", "America/New_York", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu", "Europe/London", "Europe/Paris", "Asia/Tokyo", "Australia/Sydney"].map((timezone) => <option key={timezone} value={timezone} />)}</datalist><p className="product-hint" id="timezone-hint">For example, America/Chicago. Mio uses this timezone for dates in your texts.</p></div>
    <div><label htmlFor="default-offset" className="label">Notify me this many minutes before</label><input id="default-offset" name="defaultOffsetMinutes" className="field" type="number" min={0} max={10080} step={1} defaultValue={preferences.defaultOffsetMinutes} required disabled={blocked} /><p className="product-hint">Your default when you don’t give a notification time. Use 0 to be reminded at the event time.</p></div>
    <fieldset className="product-fieldset" disabled={blocked}><legend>Quiet hours</legend><p className="product-hint">Mio won’t create or move a reminder into these hours. Applies to new reminders and schedule changes. Existing reminders keep their scheduled time.</p><div className="product-fields-row"><div><label htmlFor="quiet-start" className="label">Start</label><input type="time" id="quiet-start" name="quietHoursStart" className="field" defaultValue={preferences.quietHoursStart} /></div><div><label htmlFor="quiet-end" className="label">End</label><input type="time" id="quiet-end" name="quietHoursEnd" className="field" defaultValue={preferences.quietHoursEnd} /></div></div><p className="product-hint">Leave both empty to turn quiet hours off. Times use your timezone above.</p></fieldset>
    <p className="product-hint">Timezone and default notification changes apply to future reminders. Review existing reminders on the Reminders page.</p>
    {result && <div className={`notice ${result.ok ? "notice-success" : "notice-error"}`} role={result.ok ? "status" : "alert"}><p>{result.ok ? "Preferences saved." : result.error}</p>{!result.ok && result.refreshRequired && <button type="button" className="button button-secondary" onClick={() => window.location.reload()}>Refresh before saving again</button>}</div>}
    <button className="button button-primary" disabled={blocked}>{pending ? "Saving…" : "Save preferences"}</button>
  </form>;
}
