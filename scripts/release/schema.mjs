import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 2;
export function schemaContract(config) {
  return { version: SCHEMA_VERSION, tables: config.tables.map(t => ({
    $id: t.$id, databaseId: t.databaseId, enabled: t.enabled, rowSecurity: t.rowSecurity,
    $permissions: t.$permissions ?? [], columns: t.columns, indexes: t.indexes,
  })), buckets: config.buckets };
}
export const schemaDigest = contract => createHash("sha256").update(JSON.stringify(contract)).digest("hex");

// Structural mismatches are never silently fixed by deleting a column/index.
// Additive resources and permission tightening are safe; destructive changes
// require an explicit reviewed migration outside this beta release command.
export function compareSchema(contract, live) {
  const issues = [];
  for (const expected of contract.tables) {
    const actual = live.tables.find(t => t.$id === expected.$id && t.databaseId === expected.databaseId);
    if (!actual) { issues.push({ resource: expected.$id, kind: "missing_table", additive: true }); continue; }
    for (const key of ["enabled", "rowSecurity", "$permissions"]) {
      const a = key === "$permissions" ? [...(actual[key] ?? [])].sort() : actual[key];
      const b = key === "$permissions" ? [...expected[key]].sort() : expected[key];
      if (JSON.stringify(a) !== JSON.stringify(b)) issues.push({ resource: `${expected.$id}.${key}`, kind: "table_policy", additive: true });
    }
    for (const [collection, fields] of [["columns", ["type", "required", "array", "size", "min", "max", "default", "encrypt"]], ["indexes", ["type", "columns", "orders", "lengths"]]]) {
      for (const spec of expected[collection]) {
        const found = actual[collection].find(x => x.key === spec.key);
        const resource = `${expected.$id}.${spec.key}`;
        if (!found) { issues.push({ resource, kind: `missing_${collection}`, additive: true }); continue; }
        if (found.status !== "available") issues.push({ resource, kind: `unavailable_${collection}`, additive: false });
        for (const field of fields) if (field in spec && JSON.stringify(found[field]) !== JSON.stringify(spec[field])) {
          issues.push({ resource: `${resource}.${field}`, kind: `outdated_${collection}`, additive: false });
        }
      }
      for (const extra of actual[collection]) if (!expected[collection].some(x => x.key === extra.key)) issues.push({ resource: `${expected.$id}.${extra.key}`, kind: `unexpected_${collection}`, additive: false });
    }
  }
  for (const spec of contract.buckets) {
    const actual = live.buckets.find(x => x.$id === spec.$id);
    if (!actual) { issues.push({ resource: spec.$id, kind: "missing_bucket", additive: false }); continue; }
    for (const field of ["$permissions", "fileSecurity", "enabled", "maximumFileSize", "allowedFileExtensions", "encryption", "antivirus", "compression"]) {
      if (JSON.stringify(actual[field]) !== JSON.stringify(spec[field])) issues.push({ resource: `${spec.$id}.${field}`, kind: "bucket_policy", additive: field === "$permissions" });
    }
  }
  return issues;
}
export function assertRelease(expected, site, fn, schema) {
  if (!schema.compatible || schema.schemaVersion !== expected.schemaVersion || schema.schemaDigest !== expected.schemaDigest) throw new Error("Schema release mismatch");
  for (const [name, deployed] of [["Function", fn], ["Site", site]]) {
    if (!deployed?.ready || deployed.releaseId !== expected.releaseId || deployed.schemaVersion !== expected.schemaVersion || deployed.schemaDigest !== expected.schemaDigest) throw new Error(`${name} release mismatch`);
  }
}
export function assertRollbackPair(records, receipt, schema) {
  const match = records.find(row => row.stage === "complete" && row.functionDeploymentId === receipt.previousFunctionId && row.siteDeploymentId === receipt.previousSiteId);
  if (!match || !schema.compatible || match.schemaVersion !== schema.schemaVersion || match.schemaDigest !== schema.schemaDigest) throw new Error("Rollback pair has no verified compatible release record. No deployment was activated.");
  return match;
}
