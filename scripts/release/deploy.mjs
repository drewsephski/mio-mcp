import { execFileSync } from "node:child_process";
import { InputFile } from "node-appwrite/file";
import { setTimeout } from "node:timers/promises";
export async function deploy(ctx, kind, releaseId, record) {
  const isFunction = kind === "function";
  const service = isFunction ? ctx.functions : ctx.sites;
  const id = isFunction ? "mio-sms" : "mio-web";
  const args = isFunction ? { functionId: id } : { siteId: id };
  execFileSync("node", [`scripts/prepare-${isFunction ? "function" : "site"}.mjs`], { stdio: "inherit" });
  const archive = `.appwrite/${kind}-${releaseId}.tar.gz`;
  execFileSync("tar", ["-czf", archive, "-C", `.appwrite/${kind}`, "."], { stdio: "pipe" });
  const deployment = await service.createDeployment({ ...args, code: InputFile.fromPath(archive), activate: false });
  await record({ stage: `${kind}_building`, [isFunction ? "functionDeploymentId" : "siteDeploymentId"]: deployment.$id });
  const deadline = Date.now() + 600_000;
  let status;
  do {
    status = await service.getDeployment({ ...args, deploymentId: deployment.$id });
    if (["failed", "canceled"].includes(status.status)) throw new Error(`${kind} build failed`);
    if (status.status === "ready") break;
    await setTimeout(3000);
  } while (Date.now() < deadline);
  if (status.status !== "ready") throw new Error(`${kind} build did not become ready`);
  await record({ stage: `${kind}_activating` });
  await service[isFunction ? "updateFunctionDeployment" : "updateSiteDeployment"]({ ...args, deploymentId: deployment.$id });
  const active = await service.get(args);
  if (active.deploymentId !== deployment.$id) throw new Error(`${kind} activation could not be confirmed`);
  await record({ stage: `${kind}_active` });
  return deployment.$id;
}
