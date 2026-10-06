import { createHash, timingSafeEqual } from "node:crypto";
import { type TablesDB } from "node-appwrite";
import { contract, release } from "./release.generated.ts";

export function validOperationsToken(value: string | undefined, expected: string | undefined) {
  if (!expected || expected.length < 32 || !value) return false;
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(value), hash(expected));
}
export async function functionReadiness(tables: TablesDB) {
  const missing: string[] = [];
  for (const spec of contract.tables) {
    try {
      const table = await tables.getTable({ databaseId: spec.databaseId, tableId: spec.$id });
      if (!table.enabled || table.rowSecurity !== spec.rowSecurity || JSON.stringify([...table.$permissions].sort()) !== JSON.stringify([...spec.$permissions].sort())) missing.push(`${spec.$id}.policy`);
      for (const column of spec.columns) {
        const actual = table.columns.find(x => x.key === column.key);
        if (!actual || actual.status !== "available" || ["type", "required", "array", "size", "min", "max", "default", "encrypt"].some(key => key in column && JSON.stringify((actual as unknown as Record<string, unknown>)[key]) !== JSON.stringify((column as Record<string, unknown>)[key]))) missing.push(`${spec.$id}.${column.key}`);
      }
      for (const index of spec.indexes) {
        const actual = table.indexes.find(x => x.key === index.key);
        if (!actual || actual.status !== "available" || actual.type !== index.type || JSON.stringify(actual.columns) !== JSON.stringify(index.columns) || JSON.stringify(actual.orders) !== JSON.stringify(index.orders)) missing.push(`${spec.$id}.${index.key}`);
      }
      if (table.columns.length !== spec.columns.length || table.indexes.length !== spec.indexes.length) missing.push(`${spec.$id}.unexpected_schema`);
    } catch { missing.push(spec.$id); }
  }
  let schemaRecorded = false;
  try {
    const row = await tables.getRow({ databaseId: "mio", tableId: "schema_versions", rowId: `v${release.schemaVersion}` });
    schemaRecorded = row.version === release.schemaVersion && row.digest === release.schemaDigest;
  } catch { /* Unknown schema is incompatible. */ }
  return { ...release, ready: missing.length === 0 && schemaRecorded, schemaRecorded, requiredSchema: missing.length === 0, missing };
}
