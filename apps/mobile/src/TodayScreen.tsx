import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { formatMoment, type CompanionNote, type Reminder } from "@mio/domain";
import { mio, safeMessage } from "./client";
import { Button, Card, Feedback, styles } from "./ui";
export function TodayScreen() {
  const [notes, setNotes] = useState<CompanionNote[]>([]), [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const [n, r] = await Promise.all([mio.notes(), mio.reminders()]); setNotes(n.items.slice(0, 4)); setReminders(r.items.slice(0, 4)); }
    catch (e) { setError(safeMessage(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let alive = true;
    void Promise.all([mio.notes(), mio.reminders()]).then(([n, r]) => { if (alive) { setNotes(n.items.slice(0, 4)); setReminders(r.items.slice(0, 4)); } }).catch(e => { if (alive) setError(safeMessage(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return <><Text style={styles.title}>Today</Text><Text style={styles.text}>What’s on your mind?</Text><Text style={styles.muted}>Text Mio to save a thought or request a reminder.</Text><Feedback error={error} loading={loading} />
    <Button title="Refresh Today" secondary onPress={() => void load()} disabled={loading} /><Text style={styles.heading}>Coming up</Text>
    {reminders.length === 0 && !loading && !error && <Text style={styles.muted}>Try “Remind me tomorrow at 10 to check my application.”</Text>}
    {reminders.map(r => <Card key={r.id}><Text style={styles.text}>{r.message}</Text><Text style={styles.muted}>{formatMoment(r.remindAt, r.timezone)} · {r.timezone}</Text></Card>)}
    <Text style={styles.heading}>Recently remembered</Text>{notes.map(n => <Card key={n.$id}><Text style={styles.heading}>{n.title}</Text><Text style={styles.text} numberOfLines={3}>{n.body}</Text></Card>)}
  </>;
}
