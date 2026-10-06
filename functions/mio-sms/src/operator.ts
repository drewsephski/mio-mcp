import { createHash } from "node:crypto";
import { AppwriteException, Query, type Models, type TablesDB, type Users } from "node-appwrite";
import { hasVerifiedBetaAccess } from "./beta.ts";
import { betaMetrics, type MetricInput } from "./metrics.ts";
import { createUsageControls, type UsageLimits } from "./usage.ts";
import { functionReadiness } from "./readiness.ts";

const PAGE = 100, MAX = 20_000;
async function allRows<T extends Models.Row>(tables: TablesDB, tableId: string, fields: string[]) {
  const rows: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await tables.listRows<T>({ databaseId: "mio", tableId, queries: [Query.select(["$id", "$createdAt", "$updatedAt", ...fields]), Query.orderAsc("$id"), Query.limit(PAGE), ...(cursor ? [Query.cursorAfter(cursor)] : [])], ttl: 0 });
    rows.push(...page.rows);
    if (rows.length > MAX) throw new Error("Beta metric capacity exceeded; no partial totals returned");
    cursor = page.rows.length === PAGE ? page.rows.at(-1)!.$id : undefined;
  } while (cursor);
  return rows;
}
export async function operatorReport(tables: TablesDB, users: Users, invitedEmails: readonly string[], limits: UsageLimits, supportUserId?: string) {
  const admitted: Models.User<Models.Preferences>[] = [];
  let cursor: string | undefined;
  do {
    const page = await users.list({ queries: [Query.orderAsc("$id"), Query.limit(PAGE), ...(cursor ? [Query.cursorAfter(cursor)] : [])] });
    admitted.push(...page.users.filter(u => u.status && hasVerifiedBetaAccess(u, invitedEmails)));
    if (admitted.length > MAX) throw new Error("Beta user capacity exceeded");
    cursor = page.users.length === PAGE ? page.users.at(-1)!.$id : undefined;
  } while (cursor);
  const [connections, turns, reminders, jobs, daily, visits] = await Promise.all([
    allRows<Models.Row & MetricInput["connections"][number]>(tables, "sms_connections", ["ownerId"]), allRows<Models.Row & MetricInput["turns"][number]>(tables, "sms_turns", ["ownerId", "outcomes"]),
    allRows<Models.Row & MetricInput["reminders"][number]>(tables, "reminders", ["ownerId", "status", "revision", "syncPending", "lastError"]),
    allRows<Models.Row & MetricInput["jobs"][number]>(tables, "sms_jobs", ["ownerId", "status", "attempts", "nextAttemptAt"]),
    allRows<Models.Row & MetricInput["daily"][number]>(tables, "usage_daily", ["ownerId", "date", "inboundSms", "outboundSms", "aiTurns", "aiReservedMicros", "smsReservedMicros"]),
    allRows<Models.Row & MetricInput["visits"][number]>(tables, "companion_visits", ["ownerId", "date", "surface"]),
  ]);
  const report = betaMetrics({ users: admitted, connections, turns, reminders, jobs, daily, visits, now: new Date(), limits });
  if (supportUserId) return { user: report.users.find(u => u.userId === supportUserId) ?? null };
  const aggregate = { ...report, users: undefined };
  const global = await createUsageControls(tables, { databaseId: "mio", limits }).daily("operator_health");
  const safeErrors = new Set(["already_sent", "already_processing", "previous_already_processing", "notification_time_passed", "messaging_unavailable", "delivery_failed", "usage_limited"]);
  return { ...aggregate, circuitBreaker: global.globalLimited, admissionOpen: invitedEmails.length > 0,
    release: await functionReadiness(tables),
    latestFailures: [...reminders.filter(r => r.status === "failed" || !!r.lastError).map(r => ({ at: r.$updatedAt, kind: "reminder", code: safeErrors.has(String(r.lastError)) ? r.lastError : "reminder_unavailable" })),
      ...jobs.filter(j => j.status === "failed").map(j => ({ at: j.$updatedAt, kind: "assistant", code: "turn_failed" }))].sort((a,b) => b.at.localeCompare(a.at)).slice(0, 10),
  };
}
export async function recordVisit(tables: TablesDB, ownerId: string, surface: "web" | "mobile") {
  const date = new Date().toISOString().slice(0, 10);
  const rowId = `v_${createHash("sha256").update(`${ownerId}:${date}:${surface}`).digest("hex").slice(0, 32)}`;
  try { await tables.createRow({ databaseId: "mio", tableId: "companion_visits", rowId, data: { ownerId, date, surface }, permissions: [] }); }
  catch (e) { if (!(e instanceof AppwriteException && e.code === 409)) throw e; }
  return { recorded: true };
}
