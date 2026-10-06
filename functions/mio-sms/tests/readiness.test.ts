import assert from "node:assert/strict";
import { test } from "node:test";
import type { TablesDB } from "node-appwrite";
import { runtimeConfigurationReady } from "../src/runtime-configuration.ts";
import { functionReadiness } from "../src/readiness.ts";
import { contract, release } from "../src/release.generated.ts";
function store(missing?: string, wrongVersion = false) {
  return {
    async getTable({ tableId }: { tableId: string }) {
      if (tableId === missing) throw new Error("private provider detail");
      const table = contract.tables.find(t => t.$id === tableId)!;
      return { ...table, enabled: true, columns: table.columns.map(c => ({ ...c, status: "available" })), indexes: table.indexes.map(i => ({ ...i, status: "available" })) };
    },
    async getRow() { return { version: wrongVersion ? 0 : release.schemaVersion, digest: release.schemaDigest }; },
  } as unknown as TablesDB;
}
test("Function readiness reports build/schema identity without private data", async () => {
  const status = await functionReadiness(store());
  assert.equal(status.ready, true); assert.equal(status.releaseId, release.releaseId);
  assert.equal(status.schemaVersion, release.schemaVersion); assert.deepEqual(status.missing, []);
  assert.ok(!JSON.stringify(status).includes("provider detail"));
});
test("missing usage table or wrong durable version makes readiness fail closed", async () => {
  const missing = await functionReadiness(store("usage_daily"));
  assert.equal(missing.ready, false); assert.deepEqual(missing.missing, ["usage_daily"]);
  const old = await functionReadiness(store(undefined, true));
  assert.equal(old.schemaRecorded, false); assert.equal(old.ready, false);
});

test("runtime configuration fails closed without revealing environment inputs", () => {
  const env = { APPWRITE_FUNCTION_API_ENDPOINT: "https://example.com/v1", APPWRITE_FUNCTION_PROJECT_ID: "project", APPWRITE_SMS_PROVIDER_ID: "provider", TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32), TWILIO_AUTH_TOKEN: "private", MIO_PHONE_NUMBER: "+15555550100", TWILIO_WEBHOOK_URL: "https://example.com/inbound", OPENROUTER_API_KEY: "private", MIO_NUMBER_MODE: "dedicated", MIO_OPERATOR_USER_ID: "operator", MIO_OPERATIONS_TOKEN: "x".repeat(32), MIO_SUPPORT_EMAIL: "support@example.com", MIO_INVITE_EMAILS: "a@example.com" };
  assert.equal(runtimeConfigurationReady(env), true);
  assert.equal(runtimeConfigurationReady({ ...env, OPENROUTER_API_KEY: "" }), false);
  assert.equal(runtimeConfigurationReady({ ...env, MIO_NUMBER_MODE: "legacy-shared" }), false);
  assert.equal(runtimeConfigurationReady({ ...env, MIO_GLOBAL_AI_DAILY_MICROS: "invalid" }), false);
});
