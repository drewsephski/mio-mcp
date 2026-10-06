import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, FileText, LockKeyhole, Plus, Settings, Smartphone } from "lucide-react";
import { getAppwriteHelpers } from "@/lib/appwrite";
import { getResourceIds } from "@/lib/config";
import { getNotesService } from "@/lib/notes";
import { Brand } from "../components/brand";
import { SignOutButton } from "../components/sign-out-button";
import { VerificationBanner } from "../account/verification-banner";
import { NotesList } from "./notes-list";
import { NoteEditor } from "./note-editor";

export const metadata: Metadata = { title: "Your workspace", robots: { index: false, follow: false } };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, params] = await Promise.all([getAppwriteHelpers().getLoggedInUser(), searchParams]);
  if (!user) redirect("/auth");
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
  const userName = user.name || user.email.split("@")[0];

  return <div className="workspace">
    <a className="skip-link" href="#note-editor">Skip to editor</a>
    <aside className="sidebar" aria-label="Workspace navigation">
      <Brand />
      <nav className="sidebar-nav"><Link href="/dashboard" className={!archived ? "active" : ""} aria-label="Inbox" aria-current={!archived ? "page" : undefined}><FileText aria-hidden="true" /><span>Inbox</span></Link><Link href="/dashboard?view=archived" className={archived ? "active" : ""} aria-label="Archived notes" aria-current={archived ? "page" : undefined}><Archive aria-hidden="true" /><span>Archive</span></Link><Link href="/settings/sms" aria-label="SMS Inbox"><Smartphone aria-hidden="true" /><span>SMS Inbox</span></Link><Link href="/auth" aria-label="Your account"><Settings aria-hidden="true" /><span>Account</span></Link></nav>
      <div className="sidebar-bottom"><p className="sidebar-private"><LockKeyhole aria-hidden="true" />Private to your account</p><div className="account-summary"><span className="avatar" aria-hidden="true">{userName.slice(0, 1).toUpperCase()}</span><div><strong>{userName}</strong><small>{user.email}</small></div><SignOutButton /></div></div>
    </aside>
    <main className="workspace-main">
      <header className="workspace-header"><div className="workspace-heading"><div className="mobile-brand"><Brand /></div><div><h1>{archived ? "Archive" : "Inbox"}</h1><p>{archived ? "A place for what’s finished. Nothing lost." : "Your thoughts, captured here or by text."}</p></div></div><div className="flex items-center gap-2"><nav className="mobile-controls" aria-label="Workspace navigation"><Link href={archived ? "/dashboard" : "/dashboard?view=archived"} className="icon-button" aria-label={archived ? "Inbox" : "Archived notes"}>{archived ? <FileText aria-hidden="true" /> : <Archive aria-hidden="true" />}</Link><Link href="/settings/sms" className="icon-button" aria-label="SMS Inbox"><Smartphone aria-hidden="true" /></Link><Link href="/auth" className="icon-button" aria-label="Your account"><Settings aria-hidden="true" /></Link></nav><Link href="/dashboard?new=1" className="button button-primary"><Plus aria-hidden="true" />New note</Link></div></header>
      {!user.emailVerification && <div className="verification-banner"><VerificationBanner userEmail={user.email} /></div>}
      <div className="workspace-panels"><NotesList key={`${archived}:${search}:${cursor ?? ""}:${page.notes.map(n => `${n.id}:${n.updatedAt}`).join(",")}`} ownerId={user.$id} databaseId={databaseId} tableId={notesTableId} page={page} selectedId={note?.id} search={search} archived={archived} cursor={cursor} /><NoteEditor key={`${note?.id ?? "new"}:${note?.updatedAt ?? ""}:${isNew}`} note={note} attachments={attachments} isNew={isNew} archivedView={archived} /></div>
    </main>
  </div>;
}
