import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const config = JSON.parse(readFileSync("appwrite.config.json", "utf8"));
assert.equal(config.projectId, "68d13a4a000d854004b3");
const ids = config.tables.map(t => t.$id);
assert.equal(new Set(ids).size, ids.length);
for (const id of ["usage_daily", "usage_global", "usage_events", "schema_versions", "releases", "companion_visits"]) assert.ok(ids.includes(id), `Missing ${id}`);
for (const table of config.tables) {
  assert.equal(table.rowSecurity, true);
  assert.equal(table.enabled, true);
  assert.deepEqual(table.$permissions, ["notes", "attachments"].includes(table.$id) ? ['create("label:mioBeta")'] : []);
  const columns = new Set(table.columns.map(c => c.key));
  for (const index of table.indexes) assert.ok(index.columns.every(c => columns.has(c)));
}
assert.deepEqual(config.buckets[0].$permissions, ['create("label:mioBeta")']);
assert.equal(config.buckets[0].fileSecurity, true);
assert.equal(config.settings.auth.security.limit, 1);
for (const method of ["anonymous", "phone", "email-otp", "magic-url"]) assert.equal(config.settings.auth.methods[method], false);
assert.ok(config.functions[0].scopes.includes("tables.read"));
assert.equal(config.functions[0].entrypoint, "dist/main.js");
assert.equal(config.functions[0].runtime, "node-22");
assert.equal(config.sites[0].buildRuntime, "node-22");
assert.ok(!/OPENROUTER_API_KEY|TWILIO_AUTH_TOKEN|APPWRITE_API_KEY/.test(JSON.stringify(config)));
const source = readFileSync("scripts/prepare-site.mjs", "utf8");
assert.ok(!source.includes('".env.local"'));
const generated = path => readFileSync(path, "utf8").replace(/\/\/ You can regenerate.*\n/, "");
assert.equal(generated("lib/generated/appwrite.ts"), generated("functions/mio-sms/src/generated.ts"), "Web/Function generated types differ");
const types = generated("lib/generated/appwrite.ts");
for (const table of config.tables) {
  const name = table.name.split(/[_ -]+/).map(part => part[0].toUpperCase() + part.slice(1).toLowerCase()).join("");
  const block = types.match(new RegExp(`export type ${name} = Models.Row & \\{([\\s\\S]*?)\\n\\}`))?.[1];
  assert.ok(block, `Generated type missing: ${name}`);
  for (const column of table.columns) assert.ok(block.includes(`    ${column.key}:`), `Generated column missing: ${table.$id}.${column.key}`);
}
console.log("Static configuration and private beta permissions are consistent.");
