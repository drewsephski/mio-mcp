import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, MessageCircle, Bell } from "lucide-react";
import { getAppwriteHelpers } from "@/lib/appwrite";
import { listNotes } from "@/lib/notes";
import { getSmsStatus } from "@/lib/sms";
import { getPreferences, getReminders } from "@/lib/companion";
import { formatMoment, reminderStatus } from "@/lib/companion-models";
import { ProductShell } from "@/app/components/product-shell";
import { RefreshButton } from "./refresh-button";

export const metadata: Metadata = { title: "Today", robots: { index: false, follow: false } };

export default async function TodayPage() {
  const user = await getAppwriteHelpers().getLoggedInUser();
  if (!user) redirect("/auth");
  if (!user.emailVerification) redirect("/onboarding");
  const [reminders, notes, status, preferences] = await Promise.all([
    getReminders().catch(() => null), listNotes().catch(() => null), getSmsStatus().catch(() => null), getPreferences().catch(() => null),
  ]);
  const timezone = preferences?.timezone ?? status?.timezone ?? "America/Chicago";
  const today = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", month: "long", day: "numeric" }).format(new Date());
  const textHref = status?.connected ? `sms:${status.mioPhone}` : "/onboarding";
  return <ProductShell active="today" title={today} description={`Your day, remembered. Times in ${timezone}.`} user={user} actions={<RefreshButton />}>
    <section className="product-prompt"><div><span className="product-eyebrow">Mio</span><h2>Anything you want me to remember?</h2><p>Text a thought, ask a question, or make a change. Find it here when you need it.</p></div><Link href={textHref} className="button button-primary"><MessageCircle size={16} aria-hidden="true" />{status?.connected ? "Text Mio" : "Connect your phone"}</Link></section>
    {status === null && <p className="notice notice-error" role="alert">Phone status is unavailable. Open onboarding to check your connection.</p>}
    <section className="product-section"><div className="product-section-heading"><h2>Coming up</h2><Link href="/reminders" className="text-link">All reminders<ArrowRight size={14} aria-hidden="true" /></Link></div>
      {reminders === null ? <p className="notice notice-error" role="alert">Reminders couldn’t load. Refresh to check the latest schedule.</p> : reminders.items.length === 0 ? <div className="product-empty"><Bell size={23} aria-hidden="true" /><h3>Your next reminder starts with a text.</h3><p>Try “Remind me tomorrow at 10 to check my application.”</p></div> : <ul className="product-summary-list">{reminders.items.slice(0, 4).map((reminder) => <li key={reminder.id}><div><time dateTime={reminder.remindAt}>{formatMoment(reminder.remindAt, timezone)}</time><p>{reminder.message}</p><small>{reminderStatus(reminder)} · Event {formatMoment(reminder.eventAt, timezone)}</small></div><Link href="/reminders" className="button button-quiet" aria-label={`Manage reminder: ${reminder.message}`}>Manage</Link></li>)}</ul>}
    </section>
    <section className="product-section"><div className="product-section-heading"><h2>Recently remembered</h2><Link href="/dashboard" className="text-link">All notes<ArrowRight size={14} aria-hidden="true" /></Link></div>
      {notes === null ? <p className="notice notice-error" role="alert">Notes couldn’t load. Refresh to try again.</p> : notes.notes.length === 0 ? <div className="product-empty"><h3>A little room for your thoughts.</h3><p>Text Mio or <Link href="/dashboard?new=1" className="text-link">write your first note</Link>.</p></div> : <ul className="product-note-grid">{notes.notes.slice(0, 4).map((note) => <li key={note.id}><Link href={`/dashboard?note=${encodeURIComponent(note.id)}`}><h3>{note.title}</h3><p>{note.body.slice(0, 160) || "Open this note"}</p><small>{formatMoment(note.updatedAt, timezone)}{note.source === "sms" ? " · From SMS" : ""}</small></Link></li>)}</ul>}
    </section>
  </ProductShell>;
}
