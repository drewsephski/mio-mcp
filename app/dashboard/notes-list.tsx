"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAppwrite } from "@appwrite.io/react";
import { Channel } from "appwrite";
import { refreshNotes } from "./actions";
import { Search, X } from "lucide-react";
import type { NotesPage } from "@/lib/models";

export function NotesList({ page, selectedId, search, archived, cursor, ownerId, databaseId, tableId }: { ownerId: string; databaseId: string; tableId: string; page: NotesPage; selectedId?: string; search: string; archived: boolean; cursor?: string }) {
  const { realtime } = useAppwrite();
  const [livePage, setLivePage] = useState(page);
  const [liveStatus, setLiveStatus] = useState("");
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    let revision = 0;
    async function refresh() {
      const current = ++revision;
      try {
        const result = await refreshNotes({ search: search.length >= 3 ? search : undefined, archived, cursor });
        if (disposed || current !== revision) return;
        if (result.ok) { setLivePage(result.data); setLiveStatus(""); }
        else setLiveStatus("The list changed. Refresh to see your latest notes.");
      } catch { if (!disposed) setLiveStatus("Live updates paused. Refresh to see your latest notes."); }
    }
    const reconcile = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 120); };
    realtime.subscribe(Channel.tablesdb(databaseId).table(tableId).row(), event => {
      if ((event.payload as { ownerId?: string }).ownerId === ownerId) reconcile();
    }).then(subscription => {
      if (disposed) subscription.unsubscribe();
      else { unsubscribe = () => { subscription.unsubscribe(); }; reconcile(); }
    }).catch(() => { if (!disposed) setLiveStatus("Live updates paused. Refresh to see your latest notes."); });
    window.addEventListener("focus", reconcile);
    window.addEventListener("online", reconcile);
    return () => { disposed = true; clearTimeout(timer); unsubscribe?.(); window.removeEventListener("focus", reconcile); window.removeEventListener("online", reconcile); };
  }, [archived, cursor, databaseId, ownerId, realtime, search, tableId]);

  function href(noteId?: string, nextCursor?: string) {
    const params = new URLSearchParams();
    if (archived) params.set("view", "archived");
    if (search.length >= 3) params.set("q", search);
    if (noteId) params.set("note", noteId);
    if (nextCursor) params.set("cursor", nextCursor);
    return `/dashboard${params.size ? `?${params}` : ""}`;
  }

  return <section className="notes-pane" aria-label="Notes list">
    <form className="notes-search" action="/dashboard" method="get">
      {archived && <input type="hidden" name="view" value="archived" />}
      <label className="sr-only" htmlFor="note-search">Search note titles</label>
      <div className="search-field"><Search aria-hidden="true" /><input id="note-search" name="q" placeholder="Search titles…" defaultValue={search} minLength={3} maxLength={255} type="search" /><button type="submit" className="sr-only">Search</button>{search && <Link href={archived ? "/dashboard?view=archived" : "/dashboard"} aria-label="Clear search"><X size={14} aria-hidden="true" /></Link>}</div>
    </form>
    <p className="notes-count">{search && search.length < 3 ? "Use at least 3 characters to search." : `${livePage.total} ${livePage.total === 1 ? "note" : "notes"}${search ? " found" : ""}`}</p>
    {liveStatus && <p className="notes-live-status" role="status">{liveStatus}</p>}
    <div className="note-list">{livePage.notes.length ? livePage.notes.map(note => <Link key={note.id} href={href(note.id, cursor)} className={`note-item ${note.id === selectedId ? "selected" : ""}`} aria-current={note.id === selectedId ? "true" : undefined}><h2>{note.title}</h2><p>{note.body.trim() || "A little space to think."}</p>{note.source === "sms" && <span className="sms-provenance">SMS</span>}<time dateTime={note.updatedAt}>{new Date(note.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</time></Link>) : <p className="note-list-empty">{search ? "No matching titles. Try another search." : archived ? "Your archive is empty. Finished notes will have a place here." : "Your first thought belongs here. Create a note to get started."}</p>}</div>
    {(cursor || livePage.nextCursor) && <nav className="pagination" aria-label="Notes pagination">{cursor ? <Link href={href()}>Back to first page</Link> : <span />}{livePage.nextCursor && <Link href={href(undefined, livePage.nextCursor)}>Next 25 →</Link>}</nav>}
  </section>;
}
