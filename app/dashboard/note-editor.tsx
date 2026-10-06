"use client";

import { DotsRing } from "@/app/components/ui/dots-ring";
import { LoadingButton } from "@/app/components/loading-button";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ArchiveRestore, Check, FileText, LockKeyhole, Plus, Trash2 } from "lucide-react";
import type { Note, Attachment } from "@/lib/models";
import { createNote, updateNote, setNoteArchived, deleteNote } from "./actions";
import { Attachments } from "./attachments";

export function NoteEditor({ note, attachments, isNew, archivedView }: { note?: Note; attachments: Attachment[]; isNew: boolean; archivedView: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [operation, setOperation] = useState<"save" | "archive" | "delete">("save");
  const dirty = title !== (note?.title ?? "") || body !== (note?.body ?? "");

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const guardLink = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (link instanceof HTMLAnchorElement && !link.hasAttribute("download") && link.origin === location.origin && link.href !== location.href && !window.confirm("Leave this note and discard your unsaved changes?")) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const guardSearch = (event: Event) => {
      if (event.target instanceof HTMLFormElement && event.target.method === "get" && !window.confirm("Search and discard your unsaved changes?")) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", guardLink, true);
    document.addEventListener("submit", guardSearch, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", guardLink, true); document.removeEventListener("submit", guardSearch, true); };
  }, [dirty]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOperation("save");
    setError("");
    startTransition(async () => {
      try {
        const result = note ? await updateNote({ id: note.id, title, body }) : await createNote({ title, body });
        if (!result.ok) { setError(result.error); return; }
        router.replace(`/dashboard?note=${result.data.id}${result.data.archived ? "&view=archived" : ""}`);
        router.refresh();
      } catch { setError("Your save could not be confirmed. Refresh and check your notes before saving again."); }
    });
  }

  function archive() {
    if (!note || (dirty && !window.confirm("Discard unsaved changes and move this note?"))) return;
    setOperation("archive");
    setError("");
    startTransition(async () => {
      try {
        const result = await setNoteArchived({ id: note.id, archived: !note.archived });
        if (!result.ok) { setError(result.error); return; }
        router.replace(note.archived ? "/dashboard" : "/dashboard?view=archived"); router.refresh();
      } catch { setError("The move could not be confirmed. Refresh to check your note."); }
    });
  }

  function remove() {
    if (!note) return;
    setOperation("delete");
    startTransition(async () => {
      try {
        const result = await deleteNote(note.id);
        if (!result.ok) { setError(result.error); setConfirmDelete(false); return; }
        router.replace(archivedView ? "/dashboard?view=archived" : "/dashboard"); router.refresh();
      } catch { setError("Deletion could not be confirmed. Refresh to check your notes."); }
    });
  }

  if (!note && !isNew) return <section className="editor-pane" id="note-editor"><div className="editor-empty"><FileText aria-hidden="true" /><h2>{archivedView ? "Your archive is empty." : "Keep your first thought."}</h2><p>{archivedView ? "Archive a finished note to keep it out of your way, and close at hand." : "Write a note here or text Mio. Your saved thoughts will appear in the list."}</p><Link href="/dashboard?new=1" className="button button-primary"><Plus aria-hidden="true" />Write a note</Link></div></section>;

  return <section className="editor-pane" id="note-editor" aria-label="Note editor">
    <div className="editor-toolbar"><span className="editor-status" role="status">{pending ? <><DotsRing aria-hidden="true" />Working…</> : dirty ? "Unsaved changes" : <><Check aria-hidden="true" />{note ? "Saved" : "New note"}</>}</span><div className="editor-actions">{note && <><LoadingButton loading={pending && operation === "archive"} type="button" className="icon-button" title={note.archived ? "Restore note" : "Archive note"} aria-label={note.archived ? "Restore note" : "Archive note"} onClick={archive} disabled={pending}>{note.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}</LoadingButton><button type="button" className="icon-button" aria-label="Delete note" title="Delete note" onClick={() => setConfirmDelete(true)} disabled={pending}><Trash2 aria-hidden="true" /></button></>}<LoadingButton loading={pending && operation === "save"} form="note-form" type="submit" className="button button-primary" disabled={pending || !title.trim() || (!dirty && !!note)}>Save note</LoadingButton></div></div>
    {error && <p className="notice notice-error editor-feedback" role="alert">{error}</p>}
    {confirmDelete && <div className="editor-feedback delete-confirm"><span>Delete this note and its attachments?</span><LoadingButton loading={pending && operation === "delete"} className="button button-danger" disabled={pending} onClick={remove}>Delete permanently</LoadingButton><button className="button button-secondary" disabled={pending} onClick={() => setConfirmDelete(false)}>Keep note</button></div>}
    <form id="note-form" method="post" onSubmit={save} className="editor-content" aria-busy={pending} data-dirty={dirty}>
      {note?.source === "sms" && <p className="sms-provenance">Captured by SMS</p>}
      <p className="editor-date">{note ? new Date(note.createdAt).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "New note"}</p>
      <label htmlFor="note-title" className="sr-only">Note title</label><input id="note-title" className="note-title" placeholder="Note title" required maxLength={255} value={title} onChange={event => setTitle(event.target.value)} disabled={pending} autoFocus={isNew} />
      <label htmlFor="note-body" className="sr-only">Note body</label><textarea id="note-body" className="note-body" placeholder="What would you like to remember?" maxLength={100_000} value={body} onChange={event => setBody(event.target.value)} disabled={pending} />
      {note ? <Attachments noteId={note.id} attachments={attachments} disabled={pending || dirty} /> : <div className="attachments"><p className="attachments-hint"><LockKeyhole className="inline mr-1" size={12} aria-hidden="true" />Save your note to add private attachments.</p></div>}
    </form>
  </section>;
}
