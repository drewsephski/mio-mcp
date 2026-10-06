import { CompanionVisit } from "../components/companion-visit";
import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireBetaPage } from "@/lib/beta-page";
import { getResourceIds } from "@/lib/config";
import { getNotesService } from "@/lib/notes";
import { ProductMobileNavigation, ProductSidebar } from "../components/product-shell";
import { NotesList } from "./notes-list";
import { NoteEditor } from "./note-editor";

export const metadata: Metadata = { title: "Notes", robots: { index: false, follow: false } };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, params] = await Promise.all([requireBetaPage(), searchParams]);
  const archived = params.view === "archived";
  const search = typeof params.q === "string" ? params.q.trim() : "";
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const isNew = params.new === "1";
  const { databaseId, notesTableId } = getResourceIds();
  const service = await getNotesService();
  const page = await service.listNotes({ archived, search: search.length >= 3 ? search : undefined, cursor });
  const noteId = typeof params.note === "string" ? params.note : page.notes[0]?.id;
  const note = isNew || !noteId ? undefined : await service.getNote(noteId);
  const attachments = note ? await service.listAttachments(note.id) : [];

  return <div className="product-shell workspace"><CompanionVisit />
    <a className="skip-link" href="#note-editor">Skip to editor</a>
    <ProductSidebar active="notes" user={user} />
    <main className="workspace-main"><ProductMobileNavigation active="notes" />
      <header className="workspace-header"><div className="workspace-heading"><div><h1>{archived ? "Archive" : "Notes"}</h1><p>{archived ? "Finished notes, kept close." : "Thoughts saved here or by text."}</p></div></div><div className="flex items-center gap-2"><Link href={archived ? "/dashboard" : "/dashboard?view=archived"} className="button button-quiet">{archived ? "All notes" : "Archive"}</Link><Link href="/dashboard?new=1" className="button button-primary"><Plus aria-hidden="true" />New note</Link></div></header>
      <div className="workspace-panels"><NotesList key={`${archived}:${search}:${cursor ?? ""}:${page.notes.map(n => `${n.id}:${n.updatedAt}`).join(",")}`} ownerId={user.$id} databaseId={databaseId} tableId={notesTableId} page={page} selectedId={note?.id} search={search} archived={archived} cursor={cursor} /><NoteEditor key={`${note?.id ?? "new"}:${note?.updatedAt ?? ""}:${isNew}`} note={note} attachments={attachments} isNew={isNew} archivedView={archived} /></div>
    </main>
  </div>;
}
