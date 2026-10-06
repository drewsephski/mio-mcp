import { releaseClient, safeFailure } from "./release/client.mjs";
import { twilioReadiness } from "./twilio-readiness.mjs";
try {
  const ctx = releaseClient();
  const fn = await ctx.functions.get({ functionId: "mio-sms" });
  const site = await ctx.sites.get({ siteId: "mio-web" });
  const result = await twilioReadiness(ctx, fn.vars.find(x => x.key === "TWILIO_WEBHOOK_URL").value, site.vars.find(x => x.key === "APP_URL").value, { enforce: false });
  console.log(JSON.stringify(result, null, 2)); if (!result.ready) process.exitCode = 1;
} catch (e) { console.error(safeFailure(e)); process.exitCode = 1; }
