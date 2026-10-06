import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { Account, Client, Permission, Query, Role, Storage, TablesDB, Users } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

// Opt-in integration test against the configured Cloud project. Only disposable
// UUID-named accounts/records/files created by this run are ever cleaned up.
loadEnvFile(".env.local");
loadEnvFile(".env.provisioning");
const config = JSON.parse(await readFile("appwrite.config.json", "utf8"));
const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const authKey = process.env.APPWRITE_API_KEY;
const provisioningKey = process.env.APPWRITE_PROVISIONING_KEY;
assert.equal(endpoint, config.endpoint, "Endpoint must match the versioned configuration");
assert.equal(projectId, config.projectId, "Project must match the versioned configuration");
assert.ok(authKey && provisioningKey, "Both local authentication and provisioning keys are required");

const baseClient = () => new Client().setEndpoint(endpoint).setProject(projectId);
const adminClient = baseClient().setKey(provisioningKey);
const adminTables = new TablesDB(adminClient);
const adminStorage = new Storage(adminClient);
const users = new Users(adminClient);
const authClient = baseClient().setKey(authKey);
const authAccount = new Account(authClient);
const databaseId = process.env.APPWRITE_DATABASE_ID ?? "mio";
const notesId = process.env.APPWRITE_NOTES_TABLE_ID ?? "notes";
const attachmentsId = process.env.APPWRITE_ATTACHMENTS_TABLE_ID ?? "attachments";
const bucketId = process.env.APPWRITE_ATTACHMENTS_BUCKET_ID ?? "68d143bf001b9a793c30";
const notes = { databaseId, tableId: notesId };
const attachments = { databaseId, tableId: attachmentsId };
const bucket = { bucketId };
const ids = { userA: randomUUID(), userB: randomUUID(), note: randomUUID(), guestNote: randomUUID(), attachment: randomUUID(), file: randomUUID() };
const attempted = new Set();
const results = [];
const cleanupFailures = [];
const content = `Mio live permissions test ${ids.note}\n`;

function pass(label) {
  results.push(label);
  console.log(`PASS ${label}`);
}

function errorSummary(error) {
  // Deliberately omit response bodies and exception objects, which can include credentials.
  return { name: error?.name ?? "Error", code: error?.code ?? null, type: error?.type ?? null, message: error instanceof assert.AssertionError ? error.message : "Provider request failed" };
}

async function denied(label, operation) {
  let failure;
  try { await operation(); } catch (error) { failure = error; }
  assert.ok(failure, `${label}: request unexpectedly succeeded`);
  assert.ok([401, 403, 404].includes(failure.code), `${label}: expected an access denial; got ${failure.code ?? "network error"}`);
  pass(`${label} (HTTP ${failure.code})`);
}

async function notListed(label, operation, field, id) {
  let list;
  try { list = await operation(); } catch (error) {
    assert.ok([401, 403, 404].includes(error.code), `${label}: unexpected provider/network error`);
    pass(`${label} (HTTP ${error.code})`);
    return;
  }
  assert.ok(!list[field].some((entry) => entry.$id === id), `${label}: private resource was returned`);
  pass(label);
}

async function verifyConfiguration() {
  for (const tableId of [notesId, attachmentsId]) {
    const expected = config.tables.find((table) => table.$id === tableId && table.databaseId === databaseId);
    assert.ok(expected, `Missing ${tableId} in config`);
    const table = await adminTables.getTable({ databaseId, tableId });
    assert.equal(table.enabled, true);
    assert.equal(table.rowSecurity, true);
    assert.deepEqual([...table.$permissions].sort(), [Permission.create(Role.label("mioBeta"))]);
    const columns = await adminTables.listColumns({ databaseId, tableId, queries: [Query.limit(100)] });
    for (const column of expected.columns) {
      const live = columns.columns.find((entry) => entry.key === column.key);
      assert.ok(live, `${tableId}.${column.key} missing`);
      assert.equal(live.status, "available", `${tableId}.${column.key} not ready`);
      assert.equal(live.type, column.type, `${tableId}.${column.key} type differs`);
      assert.equal(live.required, column.required, `${tableId}.${column.key} required differs`);
      for (const field of ["array", "size", "min", "max", "default"]) {
        if (field in column) assert.deepEqual(live[field], column[field], `${tableId}.${column.key}.${field} differs`);
      }
    }
    const indexes = await adminTables.listIndexes({ databaseId, tableId, queries: [Query.limit(100)] });
    for (const index of expected.indexes) {
      const live = indexes.indexes.find((entry) => entry.key === index.key);
      assert.ok(live, `${tableId}.${index.key} missing`);
      assert.equal(live.status, "available");
      assert.equal(live.type, index.type);
      assert.deepEqual(live.columns, index.columns);
      assert.deepEqual(live.orders, index.orders);
    }
    pass(`${tableId}: live columns, indexes, row security, and create-only table permissions`);
  }
  const liveBucket = await adminStorage.getBucket(bucket);
  assert.equal(liveBucket.enabled, true);
  assert.equal(liveBucket.fileSecurity, true);
  assert.deepEqual(liveBucket.$permissions, [Permission.create(Role.label("mioBeta"))]);
  const expectedBucket = config.buckets.find((entry) => entry.$id === bucketId);
  assert.ok(expectedBucket);
  for (const field of ["maximumFileSize", "allowedFileExtensions", "encryption", "antivirus", "compression"]) {
    assert.deepEqual(liveBucket[field], expectedBucket[field], `Bucket ${field} differs`);
  }
  pass("Attachment bucket: file security, create-only authenticated access, upload limits");
  await denied("Runtime auth key cannot administer TablesDB", () => new TablesDB(authClient).getTable(notes));
  await denied("Runtime auth key cannot administer Storage", () => new Storage(authClient).getBucket(bucket));
}

async function createIdentity(id, name) {
  const email = `mio-qa-${id}@example.com`;
  const password = `${randomUUID()}Aa1!`;
  attempted.add(id);
  await users.create({ userId: id, email, password, name });
  await users.updateEmailVerification({ userId: id, emailVerification: true });
  await users.updateLabels({ userId: id, labels: ["mioBeta"] });
  const session = await authAccount.createEmailPasswordSession({ email, password });
  assert.ok(session.secret, "SSR authentication must return a session secret");
  const client = baseClient().setSession(session.secret);
  const account = new Account(client);
  assert.equal((await account.get()).$id, id);
  return { account, tables: new TablesDB(client), storage: new Storage(client) };
}

async function verifyUserAccess(a, b) {
  const guest = { tables: new TablesDB(baseClient()), storage: new Storage(baseClient()) };
  const permissions = [Permission.read(Role.user(ids.userA)), Permission.update(Role.user(ids.userA)), Permission.delete(Role.user(ids.userA))];
  const note = { ...notes, rowId: ids.note };
  const metadata = { ...attachments, rowId: ids.attachment };
  const file = { ...bucket, fileId: ids.file };
  const marker = `Mioqa${ids.note.replaceAll("-", "")}`;
  attempted.add(ids.note);
  await a.tables.createRow({ ...note, data: { ownerId: ids.userA, title: marker, body: "Original body", archived: false }, permissions });
  const ownNote = await a.tables.getRow(note);
  assert.equal(ownNote.ownerId, ids.userA);
  assert.deepEqual([...ownNote.$permissions].sort(), [...permissions].sort());
  pass("User A creates and reads an owner-only note using a session client");

  for (const [name, actor] of [["User B", b], ["Guest", guest]]) {
    await denied(`${name} cannot read User A note`, () => actor.tables.getRow(note));
    await denied(`${name} cannot update User A note`, () => actor.tables.updateRow({ ...note, data: { body: "Unauthorized edit" } }));
    await denied(`${name} cannot delete User A note`, () => actor.tables.deleteRow(note));
    await notListed(`${name} cannot list User A note without owner filtering`, () => actor.tables.listRows({ ...notes, queries: [Query.equal("$id", ids.note)], ttl: 0 }), "rows", ids.note);
  }

  await a.tables.updateRow({ ...note, data: { body: "Edited body", archived: true } });
  assert.equal((await a.tables.getRow(note)).body, "Edited body");
  const archived = await a.tables.listRows({ ...notes, queries: [Query.equal("ownerId", ids.userA), Query.equal("archived", true), Query.search("title", marker), Query.orderDesc("$updatedAt"), Query.orderDesc("$id")], ttl: 0 });
  assert.ok(archived.rows.some((entry) => entry.$id === ids.note));
  const active = await a.tables.listRows({ ...notes, queries: [Query.equal("ownerId", ids.userA), Query.equal("archived", false)], ttl: 0 });
  assert.ok(!active.rows.some((entry) => entry.$id === ids.note));
  await a.tables.updateRow({ ...note, data: { archived: false } });
  pass("User A edits, archives, searches, filters, and restores the note");

  attempted.add(ids.file);
  await a.storage.createFile({ ...file, file: InputFile.fromPlainText(content, "mio-live-qa.txt"), permissions });
  attempted.add(ids.attachment);
  await a.tables.createRow({ ...metadata, data: { ownerId: ids.userA, noteId: ids.note, fileId: ids.file, name: "mio-live-qa.txt", size: Buffer.byteLength(content), mimeType: "text/plain" }, permissions });
  assert.equal((await a.tables.getRow(metadata)).fileId, ids.file);
  const downloaded = await a.storage.getFileDownload(file);
  assert.equal(Buffer.from(downloaded).toString("utf8"), content);
  const ownAttachments = await a.tables.listRows({ ...attachments, queries: [Query.equal("noteId", ids.note), Query.equal("ownerId", ids.userA)], ttl: 0 });
  assert.ok(ownAttachments.rows.some((entry) => entry.$id === ids.attachment));
  pass("User A uploads, links, lists, and downloads the exact attachment bytes");

  for (const [name, actor] of [["User B", b], ["Guest", guest]]) {
    await denied(`${name} cannot read attachment metadata`, () => actor.tables.getRow(metadata));
    await denied(`${name} cannot update attachment metadata`, () => actor.tables.updateRow({ ...metadata, data: { name: "Unauthorized.txt" } }));
    await denied(`${name} cannot delete attachment metadata`, () => actor.tables.deleteRow(metadata));
    await notListed(`${name} cannot list attachment metadata`, () => actor.tables.listRows({ ...attachments, queries: [Query.equal("$id", ids.attachment)], ttl: 0 }), "rows", ids.attachment);
    await denied(`${name} cannot download attachment`, () => actor.storage.getFileDownload(file));
    await denied(`${name} cannot delete attachment`, () => actor.storage.deleteFile(file));
    await notListed(`${name} cannot list attachment file`, () => actor.storage.listFiles({ ...bucket, queries: [Query.equal("$id", ids.file)] }), "files", ids.file);
  }
  attempted.add(ids.guestNote);
  await denied("Guest cannot create a note", () => guest.tables.createRow({ ...notes, rowId: ids.guestNote, data: { ownerId: ids.userA, title: "Guest", body: "", archived: false } }));
  await a.storage.deleteFile(file);
  await a.tables.deleteRow(metadata);
  await a.tables.deleteRow(note);
  pass("User A deletes the owned file, attachment metadata, and note");
  await a.account.deleteSession({ sessionId: "current" });
  await denied("Deleted User A session cannot authenticate", () => a.account.get());
}

async function cleanup() {
  // All IDs originate in this process before the first mutation. Inspect each
  // deterministic ID before deletion, including mutations with uncertain responses.
  const tasks = [
    { id: ids.attachment, get: () => adminTables.getRow({ ...attachments, rowId: ids.attachment }), owned: (row) => row.ownerId === ids.userA && row.fileId === ids.file, remove: () => adminTables.deleteRow({ ...attachments, rowId: ids.attachment }) },
    { id: ids.file, get: () => adminStorage.getFile({ ...bucket, fileId: ids.file }), owned: (entry) => entry.$permissions.includes(Permission.read(Role.user(ids.userA))), remove: () => adminStorage.deleteFile({ ...bucket, fileId: ids.file }) },
    { id: ids.note, get: () => adminTables.getRow({ ...notes, rowId: ids.note }), owned: (row) => row.ownerId === ids.userA, remove: () => adminTables.deleteRow({ ...notes, rowId: ids.note }) },
    { id: ids.guestNote, get: () => adminTables.getRow({ ...notes, rowId: ids.guestNote }), owned: (row) => row.ownerId === ids.userA, remove: () => adminTables.deleteRow({ ...notes, rowId: ids.guestNote }) },
    ...[ids.userA, ids.userB].map((id) => ({ id, get: () => users.get({ userId: id }), owned: (user) => user.email === `mio-qa-${id}@example.com`, remove: () => users.delete({ userId: id }) })),
  ];
  for (const task of tasks) {
    if (!attempted.has(task.id)) continue;
    try {
      const resource = await task.get();
      assert.ok(task.owned(resource), "Refusing cleanup: disposable ownership could not be verified");
      await task.remove();
    } catch (error) {
      if (error.code === 404) continue;
      cleanupFailures.push({ id: task.id, ...errorSummary(error) });
    }
  }
  assert.equal(cleanupFailures.length, 0, "Disposable resource cleanup failed");
  pass("Cleanup confirmed: all disposable test rows, files, sessions, and users removed");
}

let failure;
try {
  await verifyConfiguration();
  const a = await createIdentity(ids.userA, "Mio integration QA A");
  const b = await createIdentity(ids.userB, "Mio integration QA B");
  pass("Two synthetic users authenticate through the minimal SSR auth key");
  await verifyUserAccess(a, b);
} catch (error) {
  failure = error;
  console.error("FAIL", JSON.stringify(errorSummary(error)));
} finally {
  try { await cleanup(); } catch (error) {
    failure ??= error;
    console.error("CLEANUP FAIL", JSON.stringify(cleanupFailures));
  }
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), projectId, databaseId, bucketId, passed: results.length, success: !failure, cleanupFailures }));
if (failure) process.exitCode = 1;
