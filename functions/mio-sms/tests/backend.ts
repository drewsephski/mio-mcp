import { AppwriteException, Client, Messaging, TablesDB, Users } from "node-appwrite";
import type { TestContext } from "node:test";

type Row = Record<string, unknown> & { $id: string; $createdAt: string; $updatedAt: string };
type Args = { tableId: string; rowId: string; data?: Record<string, unknown>; permissions?: string[]; transactionId?: string };
type Filter = { method: string; attribute?: string; values?: unknown[] };
type Transaction = { snapshot: Map<string, Row>; versions: Map<string, number>; reads: Map<string, number>; writes: Map<string, Row | null> };
export function backend(context: TestContext) {
  const rows = new Map<string, Row>(), versions = new Map<string, number>(), transactions = new Map<string, Transaction>();
  const messages = new Map<string, { $id: string; status: string; data: { content: string }; targets: string[]; scheduledAt?: string }>();
  const client = new Client();
  const tables = new TablesDB(client), users = new Users(client), messaging = new Messaging(client);
  let sequence = 0, clock = Date.parse("2026-10-06T12:00:00Z");
  let loseCommit = false, loseMessage = false, failMessage = false, failStorage = false;
  const deletedMessages: string[] = [];
  function seed(tableId: string, rowId: string, data: Record<string, unknown>) {
    const key = `${tableId}:${rowId}`;
    const row = { $id: rowId, $createdAt: new Date(clock++).toISOString(), $updatedAt: new Date(clock++).toISOString(), ...data };
    rows.set(key, row); versions.set(key, (versions.get(key) ?? 0) + 1); return row;
  }
  function read(args: Args): Row {
    const key = `${args.tableId}:${args.rowId}`, tx = args.transactionId ? transactions.get(args.transactionId) : undefined;
    const row = tx ? tx.writes.has(key) ? tx.writes.get(key) : tx.snapshot.get(key) : rows.get(key);
    if (tx && !tx.reads.has(key)) tx.reads.set(key, tx.versions.get(key) ?? 0);
    if (!row) throw new AppwriteException("Missing", 404);
    return structuredClone(row);
  }
  function write(args: Args, row: Row | null) {
    const key = `${args.tableId}:${args.rowId}`;
    if (args.transactionId) {
      const tx = transactions.get(args.transactionId)!;
      if (!tx.reads.has(key)) tx.reads.set(key, tx.versions.get(key) ?? 0);
      tx.writes.set(key, row);
    } else {
      if (row) rows.set(key, row); else rows.delete(key);
      versions.set(key, (versions.get(key) ?? 0) + 1);
    }
  }
  function matches(row: Row, filter: Filter): boolean {
    const value = row[filter.attribute ?? ""], values = filter.values ?? [];
    switch (filter.method) {
      case "equal": return values.includes(value);
      case "lessThanEqual": return String(value) <= String(values[0]);
      case "greaterThanEqual": return String(value) >= String(values[0]);
      case "lessThan": return String(value) < String(values[0]);
      case "search": return String(value).toLowerCase().includes(String(values[0]).toLowerCase());
      case "or": return values.some(item => matches(row, item as Filter));
      case "and": return values.every(item => matches(row, item as Filter));
      default: return true;
    }
  }
  context.mock.method(tables, "createTransaction", async () => {
    const $id = `tx${sequence++}`; transactions.set($id, { snapshot: structuredClone(rows), versions: new Map(versions), reads: new Map(), writes: new Map() }); return { $id };
  });
  context.mock.method(tables, "updateTransaction", async ({ transactionId, commit }: { transactionId: string; commit?: boolean }) => {
    const tx = transactions.get(transactionId);
    if (!tx) throw new AppwriteException("Missing transaction", 404);
    if (commit) {
      for (const [key, version] of tx.reads) if ((versions.get(key) ?? 0) !== version) throw new AppwriteException("Conflict", 409);
      for (const [key, row] of tx.writes) { if (row) rows.set(key, row); else rows.delete(key); versions.set(key, (versions.get(key) ?? 0) + 1); }
    }
    transactions.delete(transactionId);
    if (commit && loseCommit && [...tx.writes.keys()].some(key => key.startsWith("sms_receipts:"))) { loseCommit = false; throw new Error("Lost commit response"); }
    return {};
  });
  context.mock.method(tables, "getRow", async (args: Args) => read(args));
  context.mock.method(tables, "createRow", async (args: Args) => {
    try { read(args); throw new AppwriteException("Duplicate", 409); } catch (error) { if (!(error instanceof AppwriteException && error.code === 404)) throw error; }
    if (failStorage && args.tableId === "notes") throw new AppwriteException("Unavailable", 503);
    const row = { $id: args.rowId, $createdAt: new Date(clock++).toISOString(), $updatedAt: new Date(clock++).toISOString(), $permissions: args.permissions ?? [], ...args.data };
    write(args, row); return row;
  });
  context.mock.method(tables, "updateRow", async (args: Args) => { const row = { ...read(args), ...args.data, $updatedAt: new Date(clock++).toISOString() }; write(args, row); return row; });
  context.mock.method(tables, "deleteRow", async (args: Args) => { read(args); write(args, null); return {}; });
  context.mock.method(tables, "upsertRow", async (args: Args) => { const row = { $id: args.rowId, $createdAt: new Date(clock++).toISOString(), $updatedAt: new Date(clock++).toISOString(), ...args.data }; write(args, row); return row; });
  context.mock.method(tables, "listRows", async ({ tableId, queries = [], transactionId }: { tableId: string; queries?: string[]; transactionId?: string }) => {
    const filters: Filter[] = queries.map(query => JSON.parse(query));
    const tx = transactionId ? transactions.get(transactionId) : undefined;
    const view = tx ? new Map(tx.snapshot) : rows;
    if (tx) for (const [key, row] of tx.writes) { if (row) view.set(key, row); else view.delete(key); }
    let result = [...view.entries()].filter(([key]) => key.startsWith(`${tableId}:`)).map(([, row]) => row).filter(row => filters.every(filter => matches(row, filter)));
    for (const filter of filters.filter(f => ["orderAsc", "orderDesc"].includes(f.method)).reverse()) result.sort((a, b) => String(a[filter.attribute!]).localeCompare(String(b[filter.attribute!])) * (filter.method === "orderDesc" ? -1 : 1));
    const total = result.length;
    for (const filter of filters) {
      if (filter.method === "cursorAfter") result = result.slice(result.findIndex(row => row.$id === filter.values?.[0]) + 1);
      if (filter.method === "limit") result = result.slice(0, Number(filter.values?.[0]));
    }
    return { rows: structuredClone(result), total };
  });
  context.mock.method(users, "get", async ({ userId }: { userId: string }) => ({ $id: userId, status: true, prefs: {} }));
  context.mock.method(messaging, "getMessage", async ({ messageId }: { messageId: string }) => {
    const message = messages.get(messageId); if (!message) throw new AppwriteException("Missing", 404); return structuredClone(message);
  });
  context.mock.method(messaging, "createSMS", async ({ messageId, content, targets, draft, scheduledAt }: { messageId: string; content: string; targets: string[]; draft?: boolean; scheduledAt?: string }) => {
    if (failMessage) throw new Error("Messaging unavailable");
    if (messages.has(messageId)) throw new AppwriteException("Duplicate", 409);
    const message = { $id: messageId, status: draft ? "draft" : scheduledAt ? "scheduled" : "sent", data: { content }, targets, scheduledAt };
    messages.set(messageId, message);
    if (loseMessage) { loseMessage = false; throw new Error("Lost Messaging response"); }
    return structuredClone(message);
  });
  context.mock.method(messaging, "updateSMS", async ({ messageId, draft, scheduledAt }: { messageId: string; draft?: boolean; scheduledAt?: string }) => {
    const message = messages.get(messageId)!; message.status = draft ? "draft" : "scheduled"; message.scheduledAt = scheduledAt; return structuredClone(message);
  });
  context.mock.method(messaging, "delete", async ({ messageId }: { messageId: string }) => { if (!messages.delete(messageId)) throw new AppwriteException("Missing", 404); deletedMessages.push(messageId); return {}; });
  seed("sms_connections", "owner", { ownerId: "owner", phone: "+15550000001", targetId: "target" });
  return { tables, users, messaging, rows, messages, seed, deletedMessages,
    rowsIn: (tableId: string) => [...rows.entries()].filter(([key]) => key.startsWith(`${tableId}:`)).map(([, row]) => row),
    loseCommit: () => { loseCommit = true; }, loseMessage: () => { loseMessage = true; },
    failMessages: (value: boolean) => { failMessage = value; }, failStorage: (value: boolean) => { failStorage = value; },
  };
}
