import { releaseClient, safeFailure } from "./release/client.mjs";
import { configureAdmission } from "./release/admission.mjs";
import { convergeSchema } from "./release/migrate.mjs";
try {
  const ctx = releaseClient();
  const invites = (process.env.MIO_INVITE_EMAILS ?? "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!invites.length) throw new Error("Explicit invitations are required to preserve legitimate access during schema repair");
  await configureAdmission(ctx, invites, process.argv.includes("--apply"));
  const result = await convergeSchema(ctx, { apply: process.argv.includes("--apply") });
  console.log(JSON.stringify(result, null, 2)); if (!result.compatible) process.exitCode = 1;
} catch (e) { console.error(safeFailure(e)); process.exitCode = 1; }
