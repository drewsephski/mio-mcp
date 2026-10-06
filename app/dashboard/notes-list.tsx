"use client";

import Link from "next/link";
import { Search, X } from "lucide-react";
import type { NotesPage } from "@/lib/models";

export function NotesList({ page, selectedId, search, archived, cursor }: { page: NotesPage; selectedId?: string; search: string; archived: boolean; cursor?: string }) {
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
    <p className="notes-count">{search && search.length < 3 ? "Use at least 3 characters to search." : `${page.total} ${page.total === 1 ? "note" : "notes"}${search ? " found" : ""}`}</p>
    <div className="note-list">{page.notes.length ? page.notes.map(note => <Link key={note.id} href={href(note.id, cursor)} className={`note-item ${note.id === selectedId ? "selected" : ""}`} aria-current={note.id === selectedId ? "true" : undefined}><h2>{note.title}</h2><p>{note.body.trim() || "A little space to think."}</p><time dateTime={note.updatedAt}>{new Date(note.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</time></Link>) : <p className="note-list-empty">{search ? "No matching titles. Try another search." : archived ? "Your archive is empty. Finished notes will have a place here." : "Your first thought belongs here. Create a note to get started."}</p>}</div>
    {(cursor || page.nextCursor) && <nav className="pagination" aria-label="Notes pagination">{cursor ? <Link href={href()}>Back to first page</Link> : <span />}{page.nextCursor && <Link href={href(undefined, page.nextCursor)}>Next 25 →</Link>}</nav>}
  </section>;
}
