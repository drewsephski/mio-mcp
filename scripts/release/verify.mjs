import { ExecutionMethod } from "node-appwrite";
import { convergeSchema } from "./migrate.mjs";
import { assertRelease } from "./schema.mjs";
export async function functionStatus(ctx, token) {
  const execution = await ctx.functions.createExecution({ functionId: "mio-sms", xpath: "/ready", method: ExecutionMethod.GET, headers: { "x-mio-operations-token": token }, async: false });
  if (execution.responseStatusCode !== 200) throw new Error("Function readiness request failed");
  return JSON.parse(execution.responseBody);
}
export async function siteStatus(url, token) {
  const response = await fetch(new URL("/api/ready", url), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (!response.ok) throw new Error("Site readiness request failed");
  return response.json();
}
export async function verifyRelease(ctx, expected, url, token) {
  const schema = await convergeSchema(ctx);
  const fn = await functionStatus(ctx, token);
  const site = await siteStatus(url, token);
  assertRelease(expected, site, fn, schema);
  assertRelease(expected, site, site.function, schema);
  for (const path of ["/", "/privacy", "/terms", "/sms-terms", "/auth"]) {
    const response = await fetch(new URL(path, url), { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Site page check failed: ${path}`);
  }
  return { releaseId: expected.releaseId, schema, function: fn, site };
}
