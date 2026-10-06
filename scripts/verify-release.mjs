import { releaseClient, safeFailure } from "./release/client.mjs";
import { prepareRelease } from "./prepare-release.mjs";
import { verifyRelease } from "./release/verify.mjs";
try {
  const ctx = releaseClient();
  const site = await ctx.sites.get({ siteId: "mio-web" });
  const token = process.env.MIO_OPERATIONS_TOKEN;
  if (!token) throw new Error("MIO_OPERATIONS_TOKEN is required");
  const result = await verifyRelease(ctx, prepareRelease(), site.vars.find(v => v.key === "APP_URL").value, token);
  console.log(JSON.stringify({ releaseId: result.releaseId, schemaVersion: result.schema.schemaVersion, compatible: true, siteReady: result.site.ready, functionReady: result.function.ready }, null, 2));
} catch (e) { console.error(safeFailure(e)); process.exitCode = 1; }
