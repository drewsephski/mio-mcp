import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import type { CompanionNote } from "@mio/domain";
import { mio, safeMessage } from "./client";
import { Button, Card, Feedback, Field, styles } from "./ui";

export function NotesScreen() {
  const [notes, setNotes] = useState<CompanionNote[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<CompanionNote | null>(null), [title, setTitle] = useState(""), [body, setBody] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = useCallback(async (after?: string) => {
    setLoading(true); setError("");
    try { const page = await mio.notes(after); setNotes(old => after ? [...old, ...page.items] : page.items); setCursor(page.nextCursor); }
    catch (e) { setError(safeMessage(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let alive = true;
    void mio.notes().then(page => { if (alive) { setNotes(page.items); setCursor(page.nextCursor); } }).catch(e => { if (alive) setError(safeMessage(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  async function save() {
    if (!selected) return;
    setBusy(true); setError("");
    try { await mio.saveNote(selected.$id, { title, body }); setSelected(null); await load(); }
    catch (e) { setError(safeMessage(e)); } finally { setBusy(false); }
  }
  return <><Text style={styles.title}>Notes</Text><Feedback error={error} loading={loading} />{selected ? <Card>
    <Field label="Title" value={title} onChange={setTitle} /><Field label="Note" value={body} onChange={setBody} multiline />
    <Button title="Save note" loading={busy} onPress={() => void save()} disabled={busy} />
    <Button title="Discard edits and refresh" secondary onPress={() => { setSelected(null); void load(); }} disabled={busy} />
  </Card> : <><Text style={styles.muted}>Thoughts saved here or by text.</Text><Button title="Refresh notes" loading={loading} secondary onPress={() => void load()} disabled={loading} />
    {!loading && notes.length === 0 && <Text style={styles.text}>No notes yet. Text Mio something you want to remember.</Text>}
    {notes.map(note => <Card key={note.$id}><Text style={styles.heading}>{note.title}</Text><Text style={styles.text} numberOfLines={4}>{note.body}</Text><Button title="Read or edit" secondary onPress={() => { setSelected(note); setTitle(note.title); setBody(note.body); }} /></Card>)}
    {cursor && <Button title="More notes" loading={loading} secondary onPress={() => void load(cursor)} disabled={loading} />}</>}
  </>;
}
