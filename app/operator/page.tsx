import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOperator } from "@/lib/operations";
import { callSmsFunction } from "@/lib/sms";
import { NotesError } from "@/lib/notes-service";
import { release } from "@/functions/mio-sms/src/release.generated";
import type { operatorReport } from "@/functions/mio-sms/src/operator";
import { RefreshButton } from "@/app/today/refresh-button";

export const metadata = { title: "Beta health", robots: { index: false, follow: false } };
export default async function OperatorPage() {
  try { await requireOperator(); } catch (e) { if (e instanceof NotesError && e.status === 401) redirect("/auth"); notFound(); }
  let report: Awaited<ReturnType<typeof operatorReport>> | null = null;
  try { report = await callSmsFunction("/operator") as Awaited<ReturnType<typeof operatorReport>>; } catch { /* Show failure explicitly, never invented zeros. */ }
  if (!report || !("admittedUsers" in report)) return <main className="sms-settings-shell operator-page"><h1>Beta health</h1><p role="alert">Operational data is unavailable. Check release readiness before admitting users.</p><RefreshButton /></main>;
  const cells = [
    ["Admitted users", report.admittedUsers], ["Connected phones", report.connectedPhones], ["Active today", report.activeToday], ["Active on 3+ days / 7", report.activeThreeDays],
    ["SMS turns today / 7 days", `${report.smsTurnsToday} / ${report.smsTurnsSevenDays}`], ["AI attempts today / 7 days", `${report.aiAttemptsToday} / ${report.aiAttemptsSevenDays}`],
    ["Outbound reservations today / 7 days", `${report.outboundReservationsToday} / ${report.outboundReservationsSevenDays}`], ["Active reminders", report.activeReminders],
    ["Reminder failures", report.reminderFailures], ["Reconciliation failures", report.reconciliationFailures], ["Jobs waiting / retrying / failed", `${report.jobsWaiting} / ${report.jobsRetrying} / ${report.jobsFailed}`],
    ["Users near daily limits", report.usersNearLimits], ["Companion visitors / 7 days", report.companionVisitorsSevenDays], ["Reminder edit / cancel turns", `${report.reminderEdits} / ${report.reminderCancellations}`],
  ];
  return <main className="product-content operator-page"><header className="product-section-heading"><div><Link href="/today" className="text-link">Back to Mio</Link><h1>Beta health</h1><p className="muted">{report.window.start}–{report.window.today} · UTC · Aggregate infrastructure data</p></div><RefreshButton /></header>
    <section className="product-section"><h2>Release</h2><p className={report.release.ready && report.release.releaseId === release.releaseId ? "notice" : "notice notice-error"}>Site {release.releaseId}<br />Function {report.release.releaseId}<br />Schema {report.release.schemaVersion} · {report.release.ready ? "compatible" : "unavailable or incompatible"}</p></section>
    <section className="product-section"><h2>Admission and capacity</h2><p>{report.admissionOpen ? "Invitation allowlist configured" : "Admission closed"} · AI {report.circuitBreaker.ai ? "paused" : "available"} · SMS {report.circuitBreaker.sms ? "paused" : "available"}</p></section>
    <section className="product-section"><h2>Usage</h2><dl className="product-note-grid">{cells.map(([label, value]) => <div key={label}><dt className="muted">{label}</dt><dd style={{ fontSize: "1.5rem", margin: "0.25rem 0 1rem" }}>{value}</dd></div>)}</dl></section>
    <section className="product-section"><h2>Quality</h2>{[["Connected activation", report.connectedActivation], ["Clarification turns", report.clarification], ["Failed completed turns", report.failedAssistantTurns], ["Reminder scheduling failures", report.reminderSchedulingFailures]].map(([label, value]) => { const metric = value as typeof report.clarification; return <p key={String(label)}>{String(label)}: {metric.numerator} / {metric.denominator}{metric.rate === null ? " · no observations" : ` · ${Math.round(metric.rate * 100)}%`}</p>; })}<p className="muted">{report.unknownOutcomeTurns} historical turns have unknown outcomes. <Link href="/operator/definitions" className="text-link">Metric definitions</Link></p></section>
    <section className="product-section"><h2>Latest failures</h2>{report.latestFailures.length ? <ul>{report.latestFailures.map((failure, i) => <li key={i}>{failure.at} · {failure.kind} · {String(failure.code)}</li>)}</ul> : <p>No durable failures recorded.</p>}</section>
  </main>;
}
