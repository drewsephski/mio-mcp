import { releaseClient, safeFailure } from "./release/client.mjs";
import { convergeSchema } from "./release/migrate.mjs";
try {
  const result = await convergeSchema(releaseClient(), { apply: process.argv.includes("--apply") });
  console.log(JSON.stringify(result, null, 2));
  if (!result.compatible) process.exitCode = 1;
} catch (e) { console.error(safeFailure(e)); process.exitCode = 1; }
