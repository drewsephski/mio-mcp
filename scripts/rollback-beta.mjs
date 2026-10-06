import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Query } from "node-appwrite";
import { releaseClient, safeFailure } from "./release/client.mjs";
import { functionStatus, siteStatus } from "./release/verify.mjs";
import { assertRelease, assertRollbackPair } from "./release/schema.mjs";
import { convergeSchema } from "./release/migrate.mjs";
let ctx, locked = false;
const owner = `rollback-${randomUUID().slice(0, 20)}`;
try {
  ctx = releaseClient();
  const receipt = JSON.parse(readFileSync(process.env.MIO_ROLLBACK_RECEIPT ?? ".workflow/release-latest.json", "utf8"));
  if (!receipt.previousFunctionId || !receipt.previousSiteId) throw new Error("Both previous deployment IDs are required");
  const [fn, site] = await Promise.all([ctx.functions.getDeployment({ functionId: "mio-sms", deploymentId: receipt.previousFunctionId }), ctx.sites.getDeployment({ siteId: "mio-web", deploymentId: receipt.previousSiteId })]);
  if (fn.status !== "ready" || site.status !== "ready") throw new Error("Rollback pair is unavailable");
  const schema = await convergeSchema(ctx);
  const records = await ctx.tables.listRows({ databaseId: "mio", tableId: "releases", queries: [Query.limit(1000)] });
  if (records.total > 1000) throw new Error("Release ledger inspection overflow; rollback blocked");
  const expected = assertRollbackPair(records.rows, receipt, schema);
  if (!process.argv.includes("--apply")) { console.log("Rollback pair is retained. Add --apply to activate Function, verify it, then activate Site. Schema and variables are not reverted."); }
  else {
    await ctx.tables.createRow({ databaseId: "mio", tableId: "releases", rowId: "deployment_lock", data: { releaseId: owner, schemaVersion: schema.schemaVersion, schemaDigest: schema.schemaDigest, stage: "rollback", functionDeploymentId: "", siteDeploymentId: "", previousFunctionId: receipt.previousFunctionId, previousSiteId: receipt.previousSiteId, errorCode: "" }, permissions: [] });
    locked = true;
    await ctx.functions.updateFunctionDeployment({ functionId: "mio-sms", deploymentId: receipt.previousFunctionId });
    const activeFn = await functionStatus(ctx, process.env.MIO_OPERATIONS_TOKEN);
    assertRelease(expected, activeFn, activeFn, await convergeSchema(ctx));
    await ctx.sites.updateSiteDeployment({ siteId: "mio-web", deploymentId: receipt.previousSiteId });
    const config = await ctx.sites.get({ siteId: "mio-web" });
    const activeSite = await siteStatus(config.vars.find(v => v.key === "APP_URL").value, process.env.MIO_OPERATIONS_TOKEN);
    assertRelease(activeFn, activeSite, activeFn, schema);
    writeFileSync(".workflow/rollback-verified.json", JSON.stringify({ verifiedAt: new Date().toISOString(), releaseId: activeFn.releaseId, functionDeploymentId: receipt.previousFunctionId, siteDeploymentId: receipt.previousSiteId }, null, 2));
    console.log(`Rollback verified: ${activeFn.releaseId}`);
  }
} catch (e) { console.error("Rollback failed closed. Inspect active deployments; partial rollback is possible.", safeFailure(e)); process.exitCode = 1; }
finally {
  if (locked) {
    try {
      const lock = await ctx.tables.getRow({ databaseId: "mio", tableId: "releases", rowId: "deployment_lock" });
      if (lock.releaseId !== owner) throw new Error("Lock ownership changed");
      await ctx.tables.deleteRow({ databaseId: "mio", tableId: "releases", rowId: "deployment_lock" });
    } catch { console.error("Rollback lock cleanup could not be confirmed."); process.exitCode = 1; }
  }
}
