import { useCallback, useEffect, useState } from "react";
import { Alert, Text } from "react-native";
import { formatMoment, localDateTime, reminderStatus, type Reminder } from "@mio/domain";
import { mio, safeMessage } from "./client";
import { Button, Card, Feedback, Field, styles } from "./ui";

export function RemindersScreen() {
  const [items, setItems] = useState<Reminder[]>([]), [cursor, setCursor] = useState<string | null>(null), [history, setHistory] = useState(false);
  const [selected, setSelected] = useState<Reminder | null>(null), [event, setEvent] = useState(""), [timezone, setTimezone] = useState(""), [offset, setOffset] = useState("15"), [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = useCallback(async (after?: string) => {
    setLoading(true); setError("");
    try { const page = await mio.reminders(history ? "history" : "upcoming", after); setItems(old => after ? [...old, ...page.items] : page.items); setCursor(page.nextCursor); }
    catch (e) { setError(safeMessage(e)); } finally { setLoading(false); }
  }, [history]);
  useEffect(() => {
    let alive = true;
    void mio.reminders(history ? "history" : "upcoming").then(page => { if (alive) { setItems(page.items); setCursor(page.nextCursor); } }).catch(e => { if (alive) setError(safeMessage(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [history]);
  async function mutate(reminder: Reminder, cancel: boolean) {
    setBusy(true); setError("");
    try {
      if (cancel) await mio.cancelReminder(reminder.id, reminder.revision);
      else await mio.updateReminder({ id: reminder.id, revision: reminder.revision, eventLocal: event, timezone, offsetMinutes: Number(offset), message });
      setSelected(null); await load();
    } catch (e) { setError(safeMessage(e)); } finally { setBusy(false); }
  }
  return <><Text style={styles.title}>Reminders</Text><Feedback error={error} loading={loading} />{selected ? <Card>
    <Field label="Reminder" value={message} onChange={setMessage} /><Field label="Event local time · YYYY-MM-DDTHH:MM" value={event} onChange={setEvent} />
    <Field label="Timezone · e.g. America/Chicago" value={timezone} onChange={setTimezone} /><Field label="Minutes before event" value={offset} onChange={setOffset} />
    <Text style={styles.muted}>Mio checks quiet hours and prevents changes when a text may already be on its way.</Text>
    <Button title={busy ? "Saving…" : "Save reminder"} onPress={() => void mutate(selected, false)} disabled={busy} />
    <Button title="Discard edits and refresh" secondary onPress={() => { setSelected(null); void load(); }} disabled={busy} />
  </Card> : <><Button title={history ? "Show upcoming" : "Show history"} secondary onPress={() => { setLoading(true); setError(""); setItems([]); setHistory(!history); }} disabled={loading} /><Button title="Refresh schedule" secondary onPress={() => void load()} disabled={loading || busy} />
    {!loading && items.length === 0 && <Text style={styles.text}>{history ? "No past reminders." : "Text Mio what to remember and when."}</Text>}
    {items.map(reminder => <Card key={reminder.id}><Text style={styles.heading}>{reminder.message}</Text><Text style={styles.text}>{formatMoment(reminder.remindAt, reminder.timezone)}</Text><Text style={styles.muted}>{reminderStatus(reminder)} · {reminder.timezone}</Text>
      {["pending", "scheduled"].includes(reminder.status) && <><Button title="Edit reminder" secondary disabled={busy} onPress={() => { setSelected(reminder); setMessage(reminder.message); setEvent(localDateTime(reminder.eventAt, reminder.timezone)); setTimezone(reminder.timezone); setOffset(String(Math.round((Date.parse(reminder.eventAt) - Date.parse(reminder.remindAt)) / 60000))); }} />
      <Button title="Cancel reminder" secondary disabled={busy} onPress={() => Alert.alert("Cancel this reminder?", "Mio will cancel the pending text.", [{ text: "Keep it", style: "cancel" }, { text: "Cancel reminder", style: "destructive", onPress: () => void mutate(reminder, true) }])} /></>}
    </Card>)}{cursor && <Button title="More reminders" secondary onPress={() => void load(cursor)} disabled={loading} />}</>}
  </>;
}
