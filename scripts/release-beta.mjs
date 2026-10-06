import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, openSync, closeSync, unlinkSync } from "node:fs";
import { releaseClient, upsertVariables, safeFailure } from "./release/client.mjs";
import { prepareRelease } from "./prepare-release.mjs";
import { preflight } from "./release/preflight.mjs";
import { convergeSchema } from "./release/migrate.mjs";
import { configureAdmission } from "./release/admission.mjs";
import { deploy } from "./release/deploy.mjs";
import { assertRelease } from "./release/schema.mjs";
import { functionStatus, verifyRelease } from "./release/verify.mjs";
import { twilioReadiness } from "./twilio-readiness.mjs";

mkdirSync(".workflow", { recursive: true });
let localLock, ctx, expected, remoteLedger = false, deploymentLock = false;
const evidence = { startedAt: new Date().toISOString(), stage: "preflight", success: false };
async function record(change) {
  Object.assign(evidence, change);
  writeFileSync(".workflow/release-latest.json", JSON.stringify(evidence, null, 2));
  console.log(`Release stage: ${evidence.stage}`);
  if (deploymentLock) {
    const lock = await ctx.tables.getRow({ databaseId: "mio", tableId: "releases", rowId: "deployment_lock" });
    if (lock.releaseId !== expected.releaseId) throw new Error("Deployment lock ownership changed");
  }
  if (remoteLedger) await ctx.tables.updateRow({ databaseId: "mio", tableId: "releases", rowId: expected.releaseId, data: change });
}
const run = script => execFileSync("pnpm", [script], { stdio: "inherit" });
async function acquireDeploymentLock(row) {
  await ctx.tables.createRow({ databaseId: "mio", tableId: "releases", rowId: "deployment_lock", data: { ...row, stage: "locked" }, permissions: [] });
  deploymentLock = true;
  const [fn, site] = await Promise.all([ctx.functions.get({ functionId: "mio-sms" }), ctx.sites.get({ siteId: "mio-web" })]);
  if (fn.deploymentId !== evidence.previousFunctionId || site.deploymentId !== evidence.previousSiteId) throw new Error("Active deployments changed during preflight; inspect before releasing");
}
try {
  localLock = openSync(".workflow/release.lock", "wx");
  ctx = releaseClient();
  const plan = await preflight(ctx); // No mutation before validation.
  expected = prepareRelease();
  Object.assign(evidence, { releaseId: expected.releaseId, schemaVersion: expected.schemaVersion, schemaDigest: expected.schemaDigest, previousFunctionId: plan.fn.deploymentId, previousSiteId: plan.site.deploymentId });
  await record({ stage: "local_validation" });
  for (const script of ["check:config", "lint", "typecheck", "test", "sms:build", "build", "check:archives"]) run(script);
  if (prepareRelease().releaseId !== expected.releaseId) throw new Error("Source changed during local validation");
  if (process.argv.includes("--preflight")) { await record({ stage: "preflight_complete" }); console.log("Preflight passed. No schema, variables or deployments changed."); process.exitCode = 0; }
  else {
    const provider = await twilioReadiness(ctx, plan.webhook, plan.siteUrl);
    writeFileSync(".workflow/twilio-readiness.json", JSON.stringify(provider, null, 2));
    const row = { releaseId: expected.releaseId, schemaVersion: expected.schemaVersion, schemaDigest: expected.schemaDigest, stage: "schema_ready", functionDeploymentId: "", siteDeploymentId: "", previousFunctionId: plan.fn.deploymentId, previousSiteId: plan.site.deploymentId, errorCode: "" };
    // Once the ledger exists, lock before any production policy or DDL mutation.
    // The initial ledger bootstrap remains an explicitly single-host operation.
    let ledgerExists = true;
    try { await ctx.tables.getTable({ databaseId: "mio", tableId: "releases" }); }
    catch (e) { if (e.code !== 404) throw e; ledgerExists = false; }
    if (ledgerExists) await acquireDeploymentLock(row);
    await record({ stage: "admission_configuration" });
    await configureAdmission(ctx, plan.invited, true);
    await record({ stage: "schema_convergence" });
    const schema = await convergeSchema(ctx, { apply: true });
    if (!schema.compatible) throw new Error("Schema is incompatible; deployment blocked");
    // Durable release ledger begins once its table exists. All earlier stages
    // also remain in local evidence. No automatic rollback hides a partial release.
    try { await ctx.tables.createRow({ databaseId: "mio", tableId: "releases", rowId: expected.releaseId, data: row, permissions: [] }); }
    catch (e) { if (e.code === 409) throw new Error("This release already has a ledger. Inspect and explicitly resume or create a fresh release; never replay an uncertain deployment"); throw e; }
    if (!deploymentLock) await acquireDeploymentLock(row);
    remoteLedger = true;
    run("appwrite:generate"); run("typecheck"); run("sms:build"); run("build");
    if (prepareRelease().releaseId !== expected.releaseId) throw new Error("Source changed after schema convergence");
    await record({ stage: "configure_variables" });
    const beta = ["MIO_INVITE_EMAILS", "MIO_OPERATOR_USER_ID", "MIO_SUPPORT_EMAIL", "MIO_OPERATOR_NAME", "MIO_OPERATIONS_TOKEN"]
      .map(key => ({ key, value: process.env[key], secret: ["MIO_INVITE_EMAILS", "MIO_OPERATIONS_TOKEN"].includes(key) }));
    const limits = Object.keys(process.env).filter(key => /^MIO_(MAX_|GLOBAL_|AI_TURN_CEILING|SMS_MESSAGE_CEILING)/.test(key)).map(key => ({ key, value: process.env[key], secret: false }));
    await upsertVariables(ctx.functions, { functionId: "mio-sms" }, [...beta, ...limits, { key: "MIO_NUMBER_MODE", value: "dedicated", secret: false }]);
    await upsertVariables(ctx.sites, { siteId: "mio-web" }, [...beta, { key: "MIO_SMS_WEBHOOK_URL", value: plan.webhook, secret: false }]);
    const fnConfig = { ...ctx.config.functions[0] };
    const functionId = fnConfig.$id; delete fnConfig.$id; delete fnConfig.path;
    await ctx.functions.update({ functionId, ...fnConfig });
    await deploy(ctx, "function", expected.releaseId, record);
    const deployed = await functionStatus(ctx, plan.token);
    assertRelease(expected, deployed, deployed, await convergeSchema(ctx));
    if (prepareRelease().releaseId !== expected.releaseId) throw new Error("Source changed before Site deployment");
    await record({ stage: "function_verified" });
    await deploy(ctx, "site", expected.releaseId, record);
    await record({ stage: "post_deployment_readiness" });
    const verified = await verifyRelease(ctx, expected, plan.siteUrl, plan.token);
    writeFileSync(".workflow/release-verified.json", JSON.stringify(verified, null, 2));
    await twilioReadiness(ctx, plan.webhook, plan.siteUrl);
    if (prepareRelease().releaseId !== expected.releaseId) throw new Error("Repository changed before final release verification");
    await record({ stage: "complete" }); evidence.success = true;
    writeFileSync(".workflow/release-latest.json", JSON.stringify(evidence, null, 2));
    console.log(`VERIFIED repo = schema = Function = Site: ${expected.releaseId}`);
  }
} catch (e) {
  evidence.error = safeFailure(e);
  console.error("Release failed closed. Inspect .workflow/release-latest.json; active deployments may be partial.", evidence.error);
  if (remoteLedger) await record({ stage: "failed", errorCode: String(e.code ?? "release_check_failed") }).catch(() => { evidence.ledgerWriteFailed = true; });
  writeFileSync(".workflow/release-latest.json", JSON.stringify(evidence, null, 2)); process.exitCode = 1;
} finally {
  if (deploymentLock) {
    try {
      const lock = await ctx.tables.getRow({ databaseId: "mio", tableId: "releases", rowId: "deployment_lock" });
      if (lock.releaseId !== expected.releaseId) throw new Error("Lock owner changed");
      await ctx.tables.deleteRow({ databaseId: "mio", tableId: "releases", rowId: "deployment_lock" });
    } catch { console.error("Deployment lock cleanup failed; inspect deployment_lock before another release."); process.exitCode = 1; }
  }
  if (localLock !== undefined) { closeSync(localLock); unlinkSync(".workflow/release.lock"); } }
