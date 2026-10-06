import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Client, Functions, Sites, Storage, TablesDB, Users, Query, ID } from "node-appwrite";
export function releaseClient() {
  for (const path of [".env.local", ".env.provisioning"]) if (existsSync(path)) loadEnvFile(path);
  const config = JSON.parse(readFileSync("appwrite.config.json", "utf8"));
  if (!process.env.APPWRITE_PROVISIONING_KEY) throw new Error("APPWRITE_PROVISIONING_KEY is required (server-only)");
  for (const [key, expected] of [["NEXT_PUBLIC_APPWRITE_ENDPOINT", config.endpoint], ["NEXT_PUBLIC_APPWRITE_PROJECT_ID", config.projectId]]) {
    if (process.env[key] && process.env[key] !== expected) throw new Error(`${key} conflicts with appwrite.config.json`);
  }
  const client = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setKey(process.env.APPWRITE_PROVISIONING_KEY);
  return { config, client, tables: new TablesDB(client), functions: new Functions(client), sites: new Sites(client), storage: new Storage(client), users: new Users(client) };
}
export async function snapshot({ config, tables, storage }) {
  const result = { tables: [], buckets: [] };
  for (const t of config.tables) {
    try {
      const table = await tables.getTable({ databaseId: t.databaseId, tableId: t.$id });
      const columns = await tables.listColumns({ databaseId: t.databaseId, tableId: t.$id, queries: [Query.limit(100)] });
      const indexes = await tables.listIndexes({ databaseId: t.databaseId, tableId: t.$id, queries: [Query.limit(100)] });
      if (columns.total > 100 || indexes.total > 100) throw new Error("Schema inspection page overflow");
      result.tables.push({ ...table, databaseId: t.databaseId, columns: columns.columns, indexes: indexes.indexes });
    } catch (e) { if (e.code !== 404) throw e; }
  }
  for (const b of config.buckets) { try { result.buckets.push(await storage.getBucket({ bucketId: b.$id })); } catch (e) { if (e.code !== 404) throw e; } }
  return result;
}
export async function upsertVariables(service, args, values) {
  const old = await service.listVariables(args);
  for (const v of values) {
    const previous = old.variables.find(x => x.key === v.key);
    if (previous) await service.updateVariable({ ...args, variableId: previous.$id, ...v });
    else await service.createVariable({ ...args, variableId: ID.unique(), ...v });
  }
  // Never use --with-variables: unrelated secrets remain untouched.
}
export function safeFailure(e) { return { code: e.code ?? null, type: e.type ?? null, check: e.code ? "Provider request failed" : e.message }; }
