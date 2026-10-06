import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { getAppwriteHelpers } from "@/lib/appwrite";
import { getActivity, getPreferences } from "@/lib/companion";
import { formatMoment } from "@/lib/companion-models";
import { ProductShell } from "@/app/components/product-shell";
import { RefreshButton } from "@/app/today/refresh-button";

export const metadata: Metadata = { title: "Activity", robots: { index: false, follow: false } };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, params] = await Promise.all([getAppwriteHelpers().getLoggedInUser(), searchParams]);
  if (!user) redirect("/auth");
  if (!user.emailVerification) redirect("/onboarding");
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const [page, preferences] = await Promise.all([getActivity(cursor).catch(() => null), getPreferences().catch(() => null)]);
  const timezone = preferences?.timezone ?? "America/Chicago";
  return <ProductShell active="activity" title="Activity" description={`Your SMS conversation and the notes Mio referred to. Times in ${timezone}.`} user={user} actions={<RefreshButton />}>
    {page === null ? <p className="notice notice-error" role="alert">Activity couldn’t load. Refresh to check your conversation. <Link href="/activity" className="text-link">Open the latest activity</Link>.</p> : <>
      {page.items.length === 0 ? <div className="product-empty"><MessageCircle size={25} aria-hidden="true" /><h2>{cursor ? "You’ve reached the end." : "Your conversation starts with a text."}</h2><p>Messages and their related notes will appear here.</p><Link href="/today" className="button button-primary">Message Mio</Link></div> : <ol className="product-activity-list">{page.items.map((turn) => <li key={turn.id}><time dateTime={turn.createdAt}>{formatMoment(turn.createdAt, timezone)}</time><div className="product-transcript"><div><span>You</span><p>{turn.userText}</p></div><div><span>Mio</span><p>{turn.reply}</p></div></div>{(turn.notes.length > 0 || turn.reminderIds.length > 0) && <div className="product-activity-links">{turn.notes.map((note) => <Link key={note.id} href={`/dashboard?note=${encodeURIComponent(note.id)}`} className="text-link">{note.title || "Open note"}</Link>)}{turn.reminderIds.length > 0 && <Link href="/reminders" className="text-link">View reminder schedule</Link>}</div>}</li>)}</ol>}
      <div className="product-pagination">{cursor && <Link href="/activity" className="text-link">Back to latest</Link>}{page.nextCursor && <Link href={`/activity?cursor=${encodeURIComponent(page.nextCursor)}`} className="button button-secondary">Older activity</Link>}</div>
    </>}
  </ProductShell>;
}
