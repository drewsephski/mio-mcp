import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { assertRollbackPair, assertRelease, compareSchema, schemaContract, schemaDigest } from "../scripts/release/schema.mjs";
import { convergeSchema } from "../scripts/release/migrate.mjs";
const config = JSON.parse(readFileSync("appwrite.config.json", "utf8"));
const contract = schemaContract(config);
const liveSchema = () => ({ tables: contract.tables.map(t => ({ ...structuredClone(t), columns: t.columns.map(c => ({ ...c, status: "available" })), indexes: t.indexes.map(i => ({ ...i, status: "available" })) })), buckets: structuredClone(contract.buckets) });
test("schema compatibility detects missing usage table, pending indexes and structural drift", () => {
  const live = liveSchema();
  assert.deepEqual(compareSchema(contract, live), []);
  live.tables = live.tables.filter(t => t.$id !== "usage_daily");
  assert.ok(compareSchema(contract, live).some(i => i.resource === "usage_daily"));
  live.tables[0].columns[0].size = 10;
  live.tables[0].indexes[0].status = "processing";
  const issues = compareSchema(contract, live);
  assert.ok(issues.some(i => i.kind === "outdated_columns" && !i.additive));
  assert.ok(issues.some(i => i.kind === "unavailable_indexes" && !i.additive));
});
test("release gate refuses old Function/new Site, missing schema and mismatched schema digests", () => {
  const expected = { releaseId: "release-a", schemaVersion: 2, schemaDigest: schemaDigest(contract) };
  const ready = { ...expected, ready: true };
  const schema = { ...expected, compatible: true };
  assert.doesNotThrow(() => assertRelease(expected, ready, ready, schema));
  assert.throws(() => assertRelease(expected, ready, { ...ready, releaseId: "old" }, schema), /Function release mismatch/);
  assert.throws(() => assertRelease(expected, ready, ready, { ...schema, compatible: false }), /Schema release mismatch/);
  assert.throws(() => assertRelease(expected, { ...ready, schemaDigest: "old" }, ready, schema), /Site release mismatch/);
});
test("schema migration refuses destructive drift before a write", async () => {
  const live = liveSchema(); live.tables[0].columns[0].size = 1;
  let writes = 0;
  const tables = { async getTable({tableId}) { return live.tables.find(t => t.$id === tableId); }, async listColumns({tableId}) { return { columns: live.tables.find(t => t.$id === tableId).columns, total: 20 }; }, async listIndexes({tableId}) { return { indexes: live.tables.find(t => t.$id === tableId).indexes, total: 3 }; }, async createTable() { writes++; } };
  const ctx = { config, tables, storage: { async getBucket() { return live.buckets[0]; } } };
  await assert.rejects(convergeSchema(ctx, {apply:true}), /reviewed migration/);
  assert.equal(writes, 0);
});
test("permission tightening retains owner file security and all upload restrictions", async () => {
  const live = liveSchema(); live.buckets[0].$permissions = ['create("users")'];
  let saved;
  const tables = { async getTable({tableId}) {return live.tables.find(t=>t.$id===tableId);},async listColumns({tableId}) {const columns=live.tables.find(t=>t.$id===tableId).columns;return {columns,total:columns.length};},async listIndexes({tableId}){const indexes=live.tables.find(t=>t.$id===tableId).indexes;return {indexes,total:indexes.length};},async getRow(){return {digest:schemaDigest(contract)};} };
  const ctx={config,tables,storage:{async getBucket(){return live.buckets[0];},async updateBucket(args){saved=args;live.buckets[0]={...live.buckets[0],...args,$permissions:args.permissions};}}};
  await convergeSchema(ctx,{apply:true});
  assert.equal(saved.fileSecurity,true);assert.equal(saved.maximumFileSize,10_485_760);assert.deepEqual(saved.allowedFileExtensions,contract.buckets[0].allowedFileExtensions);assert.equal(saved.antivirus,true);
});

test("rollback refuses unversioned, failed or schema-incompatible pairs before activation", () => {
  const receipt = { previousFunctionId: "fn", previousSiteId: "site" }, schema = { compatible: true, schemaVersion: 2, schemaDigest: "digest" };
  const row = { stage: "complete", functionDeploymentId: "fn", siteDeploymentId: "site", schemaVersion: 2, schemaDigest: "digest" };
  assert.throws(() => assertRollbackPair([], receipt, schema), /No deployment was activated/);
  assert.throws(() => assertRollbackPair([{ ...row, stage: "failed" }], receipt, schema));
  assert.throws(() => assertRollbackPair([row], receipt, { ...schema, schemaDigest: "new" }));
  assert.equal(assertRollbackPair([row], receipt, schema), row);
});
