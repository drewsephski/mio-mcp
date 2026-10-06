import type { UsageLimits } from "./usage.ts";

type User = { $id: string };
type Connection = { ownerId: string; $createdAt: string };
type Turn = { ownerId: string; $createdAt: string; outcomes?: string[] | null };
type Reminder = { ownerId: string; $createdAt: string; status: string; revision: number; syncPending: boolean; lastError: string };
type Job = { ownerId: string; $createdAt: string; $updatedAt: string; status: string; attempts: number; nextAttemptAt: string };
type Daily = { ownerId: string; date: string; inboundSms: number; outboundSms: number; aiTurns: number; aiReservedMicros: number; smsReservedMicros: number };
type Visit = { ownerId: string; date: string; surface: string };
export type MetricInput = { users: User[]; connections: Connection[]; turns: Turn[]; reminders: Reminder[]; jobs: Job[]; daily: Daily[]; visits: Visit[]; now: Date; limits: UsageLimits };

// Pure definitions; calendar windows are UTC, including today and six prior
// days. Historical turns without outcomes are explicitly unknown for quality.
export function betaMetrics(input: MetricInput) {
  const { now, limits } = input;
  const today = now.toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const admitted = new Set(input.users.map(u => u.$id));
  const included = <T extends { ownerId: string }>(items: T[]) => items.filter(x => admitted.has(x.ownerId));
  const connections = included(input.connections), turns = included(input.turns), reminders = included(input.reminders), jobs = included(input.jobs), daily = included(input.daily);
  const week = (day: string) => day >= start && day <= today;
  const recent = turns.filter(t => week(t.$createdAt.slice(0, 10)));
  const active = new Map<string, Set<string>>();
  for (const turn of recent) {
    const days = active.get(turn.ownerId) ?? new Set(); days.add(turn.$createdAt.slice(0, 10)); active.set(turn.ownerId, days);
  }
  const known = recent.filter(t => (t.outcomes?.length ?? 0) > 0);
  const success = turns.filter(t => !t.outcomes?.includes("failed"));
  const completed = jobs.filter(j => ["done", "failed"].includes(j.status) && week(j.$createdAt.slice(0, 10)));
  const failed = completed.filter(j => j.status === "failed");
  const recentReminders = reminders.filter(r => week(r.$createdAt.slice(0, 10)));
  const schedulingFailures = recentReminders.filter(r => r.status === "failed");
  const dayUsage = daily.filter(d => d.date === today);
  const sum = (rows: Daily[], key: keyof Pick<Daily, "inboundSms" | "outboundSms" | "aiTurns" | "aiReservedMicros" | "smsReservedMicros">) => rows.reduce((n, d) => n + d[key], 0);
  const rate = (n: number, denominator: number) => ({ numerator: n, denominator, rate: denominator ? n / denominator : null });
  const near = dayUsage.filter(d => d.aiTurns >= limits.aiPerDay * .8 || d.outboundSms >= limits.outboundPerDay * .8).map(d => d.ownerId);
  const first = (ownerId: string, items: { ownerId: string; $createdAt: string }[]) => items.filter(x => x.ownerId === ownerId).map(x => x.$createdAt).sort()[0] ?? null;
  return {
    window: { today, start, timezone: "UTC" }, admittedUsers: admitted.size, connectedPhones: connections.length,
    activeToday: new Set(recent.filter(t => t.$createdAt.startsWith(today)).map(t => t.ownerId)).size,
    activeThreeDays: [...active.values()].filter(days => days.size >= 3).length,
    smsTurnsToday: recent.filter(t => t.$createdAt.startsWith(today)).length, smsTurnsSevenDays: recent.length,
    aiAttemptsToday: sum(dayUsage, "aiTurns"), aiAttemptsSevenDays: sum(daily.filter(d => week(d.date)), "aiTurns"),
    outboundReservationsToday: sum(dayUsage, "outboundSms"), outboundReservationsSevenDays: sum(daily.filter(d => week(d.date)), "outboundSms"),
    activeReminders: reminders.filter(r => ["pending", "scheduled"].includes(r.status)).length,
    reminderFailures: reminders.filter(r => r.status === "failed").length,
    reconciliationFailures: reminders.filter(r => r.syncPending && !!r.lastError).length,
    jobsWaiting: jobs.filter(j => j.status === "queued" && j.attempts === 0).length,
    jobsRetrying: jobs.filter(j => j.status === "queued" && j.attempts > 0).length,
    jobsFailed: jobs.filter(j => j.status === "failed").length,
    usersNearLimits: new Set(near).size,
    connectedActivation: rate(connections.filter(c => success.some(t => t.ownerId === c.ownerId && t.$createdAt >= c.$createdAt)).length, connections.length),
    clarification: rate(known.filter(t => t.outcomes!.includes("clarification")).length, known.length),
    failedAssistantTurns: rate(failed.length, completed.length),
    reminderSchedulingFailures: rate(schedulingFailures.length, recentReminders.length),
    reminderRejectedTurns: known.filter(t => t.outcomes!.includes("reminder_rejected")).length,
    reminderEdits: known.filter(t => t.outcomes!.includes("updated_reminder")).length,
    reminderCancellations: known.filter(t => t.outcomes!.includes("canceled_reminder")).length,
    webReminderEditsObserved: recentReminders.filter(r => r.revision > 1).length,
    unknownOutcomeTurns: recent.length - known.length,
    companionVisitorsSevenDays: new Set(included(input.visits).filter(v => week(v.date)).map(v => v.ownerId)).size,
    // Opt-in support route consumes these safe infrastructure summaries. The
    // aggregate operator response omits them, and never reads private text.
    users: input.users.map(u => ({ userId: u.$id, connected: connections.some(c => c.ownerId === u.$id),
      firstSuccessfulTurn: first(u.$id, success), firstSuccessfulReminder: first(u.$id, reminders.filter(r => r.status === "sent")),
      activeSmsDays: active.get(u.$id)?.size ?? 0, nearLimit: near.includes(u.$id),
      failedJobs: jobs.filter(j => j.ownerId === u.$id && j.status === "failed").length,
      failedReminders: reminders.filter(r => r.ownerId === u.$id && r.status === "failed").length })),
  };
}
