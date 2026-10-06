import { createHash } from "node:crypto";
import { AppwriteException, Permission, Role, type Models, type TablesDB } from "node-appwrite";

// These are reservation ceilings in USD microdollars, not provider invoices.
// A failed or ambiguous operation keeps its reservation until the UTC day ends.
export const defaultUsageLimits = {
  inboundPerMinute: 6, aiPerHour: 30, aiPerDay: 100, outboundPerDay: 200,
  maxActiveReminders: 50, maxScheduledOutbound: 75,
  aiTurnCeilingMicros: 250_000, smsMessageCeilingMicros: 500_000,
  globalAiDailyMicros: 20_000_000, globalSmsDailyMicros: 10_000_000,
};
export type UsageLimits = typeof defaultUsageLimits;
const envKeys: Record<keyof UsageLimits, string> = {
  inboundPerMinute: "MIO_MAX_INBOUND_PER_MINUTE", aiPerHour: "MIO_MAX_AI_PER_HOUR", aiPerDay: "MIO_MAX_AI_PER_DAY",
  outboundPerDay: "MIO_MAX_OUTBOUND_PER_DAY", maxActiveReminders: "MIO_MAX_ACTIVE_REMINDERS",
  maxScheduledOutbound: "MIO_MAX_SCHEDULED_OUTBOUND", aiTurnCeilingMicros: "MIO_AI_TURN_CEILING_MICROS",
  smsMessageCeilingMicros: "MIO_SMS_MESSAGE_CEILING_MICROS", globalAiDailyMicros: "MIO_GLOBAL_AI_DAILY_MICROS",
  globalSmsDailyMicros: "MIO_GLOBAL_SMS_DAILY_MICROS",
};
function validateLimits(limits: UsageLimits): UsageLimits {
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid usage limit: ${key}`);
  }
  // A zero ceiling cannot silently remove the spend circuit breaker.
  if (!limits.aiTurnCeilingMicros || !limits.smsMessageCeilingMicros) throw new Error("Usage cost ceilings must be positive");
  return limits;
}
export function usageLimitsFromEnv(env: Record<string, string | undefined>): UsageLimits {
  const limits = { ...defaultUsageLimits };
  for (const key of Object.keys(envKeys) as (keyof UsageLimits)[]) {
    const raw = env[envKeys[key]];
    if (raw !== undefined) {
      if (!/^\d+$/.test(raw)) throw new Error(`Invalid usage limit: ${envKeys[key]}`);
      limits[key] = Number(raw);
    }
  }
  return validateLimits(limits);
}
export class UsageLimitError extends Error {
  readonly limit: string;
  constructor(limit: string) { super("Mio's usage limit has been reached. Please try again later."); this.limit = limit; }
}
export type UsageKind = "inbound" | "ai" | "outbound";
export type UsageDaily = Models.Row & {
  ownerId: string; date: string; inboundSms: number; outboundSms: number; aiTurns: number;
  inputTokens: number; outputTokens: number; aiReservedMicros: number; smsReservedMicros: number;
};
type Bucket = Models.Row & { bucketKey: string; count: number; aiReservedMicros: number; smsReservedMicros: number };
type UsageEvent = Models.Row & {
  ownerId: string; operationHash: string; kind: UsageKind; date: string; dailyId: string;
  inputTokens: number; outputTokens: number; usageRecorded: boolean;
};
const id = (value: string) => `u_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const missing = (error: unknown) => error instanceof AppwriteException && error.code === 404;
const emptyCounts = { inboundSms: 0, outboundSms: 0, aiTurns: 0, inputTokens: 0, outputTokens: 0, aiReservedMicros: 0, smsReservedMicros: 0 };

export function createUsageControls(tables: TablesDB, config: { databaseId: string; limits?: Partial<UsageLimits>; now?: () => Date }) {
  const limits = validateLimits({ ...defaultUsageLimits, ...config.limits });
  const now = config.now ?? (() => new Date());
  const resource = (tableId: string) => ({ databaseId: config.databaseId, tableId });
  async function optional<T extends Models.Row>(tableId: string, rowId: string, transactionId?: string): Promise<T | null> {
    try { return await tables.getRow<T>({ ...resource(tableId), rowId, transactionId }); }
    catch (error) { if (missing(error)) return null; throw error; }
  }
  async function bucket(bucketKey: string, transactionId: string) {
    const rowId = id(bucketKey);
    const existing = await optional<Bucket>("usage_global", rowId, transactionId);
    return { rowId, existing, data: existing ?? { bucketKey, count: 0, aiReservedMicros: 0, smsReservedMicros: 0 } };
  }
  async function writeBucket(value: Awaited<ReturnType<typeof bucket>>, changes: Partial<Bucket>, transactionId: string) {
    const args = { ...resource("usage_global"), rowId: value.rowId, transactionId, data: { ...value.data, ...changes } };
    // Never copy Appwrite metadata back into row data.
    args.data = { bucketKey: args.data.bucketKey, count: args.data.count, aiReservedMicros: args.data.aiReservedMicros, smsReservedMicros: args.data.smsReservedMicros };
    if (value.existing) await tables.updateRow(args);
    else await tables.createRow({ ...args, permissions: [] });
  }
  function assertEvent(event: UsageEvent, ownerId: string, kind: UsageKind, operationHash: string) {
    if (event.ownerId !== ownerId || event.kind !== kind || event.operationHash !== operationHash) throw new Error("Usage reservation identity mismatch");
  }
  async function reserve(input: { ownerId: string; operationId: string; kind: UsageKind }) {
    if (!input.ownerId || input.ownerId.length > 36 || !input.operationId || input.operationId.length > 200) throw new Error("Invalid usage reservation identity");
    const operationHash = hash(`${input.ownerId}:${input.kind}:${input.operationId}`);
    const reservationId = id(`event:${operationHash}`);
    const previous = await optional<UsageEvent>("usage_events", reservationId);
    if (previous) { assertEvent(previous, input.ownerId, input.kind, operationHash); return { reservationId, created: false }; }
    const instant = now().toISOString(), date = instant.slice(0, 10), dailyId = id(`daily:${input.ownerId}:${date}`);
    const transaction = await tables.createTransaction({ ttl: 60 });
    try {
      const duplicate = await optional<UsageEvent>("usage_events", reservationId, transaction.$id);
      if (duplicate) {
        assertEvent(duplicate, input.ownerId, input.kind, operationHash);
        await tables.updateTransaction({ transactionId: transaction.$id, rollback: true });
        return { reservationId, created: false };
      }
      const existingDaily = await optional<UsageDaily>("usage_daily", dailyId, transaction.$id);
      const daily = { ...emptyCounts, ownerId: input.ownerId, date, ...existingDaily };
      const global = await bucket(`global:${date}`, transaction.$id);
      const aiCost = input.kind === "ai" ? limits.aiTurnCeilingMicros : 0;
      const smsCost = input.kind === "ai" ? 0 : limits.smsMessageCeilingMicros;
      if (global.data.aiReservedMicros + aiCost > limits.globalAiDailyMicros) throw new UsageLimitError("globalAiDailyMicros");
      if (global.data.smsReservedMicros + smsCost > limits.globalSmsDailyMicros) throw new UsageLimitError("globalSmsDailyMicros");
      if (input.kind === "inbound") {
        const minute = await bucket(`minute:${input.ownerId}:${instant.slice(0, 16)}`, transaction.$id);
        if (minute.data.count >= limits.inboundPerMinute) throw new UsageLimitError("inboundPerMinute");
        await writeBucket(minute, { count: minute.data.count + 1 }, transaction.$id);
        daily.inboundSms++;
      } else if (input.kind === "ai") {
        const hour = await bucket(`hour:${input.ownerId}:${instant.slice(0, 13)}`, transaction.$id);
        if (hour.data.count >= limits.aiPerHour) throw new UsageLimitError("aiPerHour");
        if (daily.aiTurns >= limits.aiPerDay) throw new UsageLimitError("aiPerDay");
        await writeBucket(hour, { count: hour.data.count + 1 }, transaction.$id);
        daily.aiTurns++;
      } else {
        if (daily.outboundSms >= limits.outboundPerDay) throw new UsageLimitError("outboundPerDay");
        daily.outboundSms++;
      }
      daily.aiReservedMicros += aiCost; daily.smsReservedMicros += smsCost;
      await writeBucket(global, { count: global.data.count + 1, aiReservedMicros: global.data.aiReservedMicros + aiCost,
        smsReservedMicros: global.data.smsReservedMicros + smsCost }, transaction.$id);
      const dailyData = Object.fromEntries(["ownerId", "date", ...Object.keys(emptyCounts)].map(key => [key, daily[key as keyof typeof daily]]));
      const dailyArgs = { ...resource("usage_daily"), rowId: dailyId, data: dailyData, transactionId: transaction.$id };
      if (existingDaily) await tables.updateRow(dailyArgs);
      else await tables.createRow({ ...dailyArgs, permissions: [Permission.read(Role.user(input.ownerId))] });
      await tables.createRow({ ...resource("usage_events"), rowId: reservationId, transactionId: transaction.$id, permissions: [],
        data: { ownerId: input.ownerId, operationHash, kind: input.kind, date, dailyId, inputTokens: 0, outputTokens: 0, usageRecorded: false } });
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
      return { reservationId, created: true };
    } catch (error) {
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {});
      // Read durable identity after an ambiguous commit, never repeat the write.
      const persisted = await optional<UsageEvent>("usage_events", reservationId);
      if (persisted) { assertEvent(persisted, input.ownerId, input.kind, operationHash); return { reservationId, created: false }; }
      throw error;
    }
  }
  async function reportUsage(reservationId: string, usage: { inputTokens: number; outputTokens: number }) {
    for (const value of [usage.inputTokens, usage.outputTokens]) if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid observed token usage");
    const transaction = await tables.createTransaction({ ttl: 60 });
    try {
      const event = await tables.getRow<UsageEvent>({ ...resource("usage_events"), rowId: reservationId, transactionId: transaction.$id });
      if (event.kind !== "ai") throw new Error("Token usage requires an AI reservation");
      if (!event.usageRecorded) {
        const daily = await tables.getRow<UsageDaily>({ ...resource("usage_daily"), rowId: event.dailyId, transactionId: transaction.$id });
        await tables.updateRow({ ...resource("usage_daily"), rowId: daily.$id, transactionId: transaction.$id,
          data: { inputTokens: daily.inputTokens + usage.inputTokens, outputTokens: daily.outputTokens + usage.outputTokens } });
        await tables.updateRow({ ...resource("usage_events"), rowId: reservationId, transactionId: transaction.$id,
          data: { ...usage, usageRecorded: true } });
      }
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    } catch (error) {
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {});
      if (!(await optional<UsageEvent>("usage_events", reservationId))?.usageRecorded) throw error;
    }
  }
  async function daily(ownerId: string) {
    if (!ownerId || ownerId.length > 36) throw new Error("Invalid usage owner");
    const date = now().toISOString().slice(0, 10);
    const [row, global] = await Promise.all([
      optional<UsageDaily>("usage_daily", id(`daily:${ownerId}:${date}`)),
      optional<Bucket>("usage_global", id(`global:${date}`)),
    ]);
    if (row && (row.ownerId !== ownerId || row.date !== date)) throw new Error("Usage ownership mismatch");
    return {
      date,
      inboundSms: row?.inboundSms ?? 0, outboundSms: row?.outboundSms ?? 0, aiTurns: row?.aiTurns ?? 0,
      inputTokens: row?.inputTokens ?? 0, outputTokens: row?.outputTokens ?? 0,
      aiReservedMicros: row?.aiReservedMicros ?? 0, smsReservedMicros: row?.smsReservedMicros ?? 0,
      limits: { inboundPerMinute: limits.inboundPerMinute, aiPerHour: limits.aiPerHour, aiPerDay: limits.aiPerDay,
        outboundPerDay: limits.outboundPerDay, maxActiveReminders: limits.maxActiveReminders, maxScheduledOutbound: limits.maxScheduledOutbound },
      globalLimited: {
        ai: (global?.aiReservedMicros ?? 0) + limits.aiTurnCeilingMicros > limits.globalAiDailyMicros,
        sms: (global?.smsReservedMicros ?? 0) + limits.smsMessageCeilingMicros > limits.globalSmsDailyMicros,
      },
    };
  }
  return { limits, reserve, reportUsage, daily };
}
