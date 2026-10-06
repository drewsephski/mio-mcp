import { setTimeout } from "node:timers/promises";
import { compareSchema, schemaContract, schemaDigest } from "./schema.mjs";
import { snapshot } from "./client.mjs";

export async function convergeSchema(ctx, { apply = false } = {}) {
  const contract = schemaContract(ctx.config);
  let live = await snapshot(ctx);
  let issues = compareSchema(contract, live);
  if (!apply) return { compatible: issues.length === 0, schemaVersion: contract.version, schemaDigest: schemaDigest(contract), issues };
  const unsafe = issues.filter(x => !x.additive);
  if (unsafe.length) throw new Error(`Schema requires reviewed migration: ${unsafe.map(x => x.resource).join(", ")}`);
  for (const spec of contract.tables) {
    const args = { databaseId: spec.databaseId, tableId: spec.$id };
    let table = live.tables.find(t => t.$id === spec.$id);
    if (!table) {
      // A lost creation response aborts the release; next invocation inspects
      // deterministic IDs. No automatic replay of uncertain mutations.
      table = await ctx.tables.createTable({ ...args, name: spec.$id, permissions: spec.$permissions, rowSecurity: spec.rowSecurity, enabled: spec.enabled });
    } else if (issues.some(x => x.kind === "table_policy" && x.resource.startsWith(`${spec.$id}.`))) {
      await ctx.tables.updateTable({ ...args, permissions: spec.$permissions, rowSecurity: spec.rowSecurity, enabled: spec.enabled });
    }
    const known = new Set(table.columns.map(c => c.key));
    for (const column of spec.columns) {
      if (known.has(column.key)) continue;
      const method = { varchar: "createVarcharColumn", mediumtext: "createMediumtextColumn", text: "createTextColumn", boolean: "createBooleanColumn", integer: "createIntegerColumn", datetime: "createDatetimeColumn" }[column.type];
      if (!method) throw new Error(`Unsupported column type ${column.type}`);
      const params = { ...column };
      const xdefault = params.default; delete params.type; delete params.default;
      await ctx.tables[method]({ ...args, ...params, ...(xdefault == null ? {} : { xdefault }) });
    }
    await waitAvailable(ctx.tables, args, "columns", spec.columns);
    const indexes = await ctx.tables.listIndexes(args);
    for (const index of spec.indexes) if (!indexes.indexes.some(x => x.key === index.key)) await ctx.tables.createIndex({ ...args, ...index });
    await waitAvailable(ctx.tables, args, "indexes", spec.indexes);
  }
  for (const spec of contract.buckets) if (issues.some(x => x.resource === `${spec.$id}.$permissions`)) await ctx.storage.updateBucket({ bucketId: spec.$id, name: spec.name, permissions: spec.$permissions, fileSecurity: spec.fileSecurity, enabled: spec.enabled, maximumFileSize: spec.maximumFileSize, allowedFileExtensions: spec.allowedFileExtensions, compression: spec.compression, encryption: spec.encryption, antivirus: spec.antivirus });
  live = await snapshot(ctx); issues = compareSchema(contract, live);
  if (issues.length) throw new Error(`Schema failed convergence: ${issues.map(x => x.resource).join(", ")}`);
  const versionArgs = { databaseId: "mio", tableId: "schema_versions", rowId: `v${contract.version}` };
  const digest = schemaDigest(contract);
  try {
    const recorded = await ctx.tables.getRow(versionArgs);
    if (recorded.digest !== digest) throw new Error("Schema version is immutable; increment version for a changed contract");
  } catch (e) {
    if (e.code !== 404) throw e;
    await ctx.tables.createRow({ ...versionArgs, data: { version: contract.version, digest, appliedAt: new Date().toISOString() }, permissions: [] });
  }
  return { compatible: true, schemaVersion: contract.version, schemaDigest: digest, issues: [] };
}
async function waitAvailable(tables, args, kind, intended) {
  const deadline = Date.now() + 180_000;
  do {
    const page = await tables[kind === "columns" ? "listColumns" : "listIndexes"](args);
    const rows = page[kind];
    if (rows.some(x => ["failed", "stuck"].includes(x.status))) throw new Error(`Schema ${kind} failed`);
    if (intended.every(x => rows.some(y => y.key === x.key && y.status === "available"))) return;
    await setTimeout(1000);
  } while (Date.now() < deadline);
  throw new Error(`Schema ${kind} availability timed out`);
}
