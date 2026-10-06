import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { getAppwriteHelpers } from "@/lib/appwrite";
import { getReminders } from "@/lib/companion";
import { ProductShell } from "@/app/components/product-shell";
import { RefreshButton } from "@/app/today/refresh-button";
import { ReminderCard } from "./reminder-card";

export const metadata: Metadata = { title: "Reminders", robots: { index: false, follow: false } };

export default async function RemindersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, params] = await Promise.all([getAppwriteHelpers().getLoggedInUser(), searchParams]);
  if (!user) redirect("/auth");
  if (!user.emailVerification) redirect("/onboarding");
  const view = params.view === "history" ? "history" : "upcoming";
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const page = await getReminders(view, cursor).catch(() => null);
  return <ProductShell active="reminders" title="Reminders" description="See exactly when Mio will text you. Each reminder shows its own timezone." user={user} actions={<RefreshButton />}>
    <nav className="product-tabs" aria-label="Reminder views"><Link href="/reminders" aria-current={view === "upcoming" ? "page" : undefined}>Upcoming</Link><Link href="/reminders?view=history" aria-current={view === "history" ? "page" : undefined}>History</Link></nav>
    {page === null ? <p className="notice notice-error" role="alert">Reminders couldn’t load. Refresh to check the latest schedule. <Link className="text-link" href="/reminders">Start from upcoming reminders</Link>.</p> : <>
      {page.items.length === 0 ? <div className="product-empty"><Bell size={25} aria-hidden="true" /><h2>{view === "history" ? "No past reminders here yet." : "Nothing scheduled here yet."}</h2><p>{cursor ? "You’ve reached the end of this list." : view === "history" ? "Sent and cancelled reminders will appear here." : "Text Mio what you want to remember and when."}</p>{view === "upcoming" && <Link href="/today" className="button button-primary">Message Mio</Link>}</div> : <ul className="product-reminder-list">{page.items.map((reminder) => <ReminderCard key={`${reminder.id}:${reminder.revision}:${reminder.status}:${reminder.syncPending}`} reminder={reminder} />)}</ul>}
      <div className="product-pagination">{cursor && <Link href={`/reminders?view=${view}`} className="text-link">Back to first page</Link>}{page.nextCursor && <Link href={`/reminders?view=${view}&cursor=${encodeURIComponent(page.nextCursor)}`} className="button button-secondary">More reminders</Link>}</div>
    </>}
  </ProductShell>;
}
