import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Deploy an explicit source allowlist. Local env files and provisioning keys
// never enter the upload, regardless of CLI archive-ignore behavior.
const sourcePaths = [
  "app", "lib", "packages/domain/src", "packages/domain/package.json", "public", "package.json", "pnpm-lock.yaml",
  "pnpm-workspace.yaml", "next.config.ts", "postcss.config.mjs",
  "tsconfig.json", "eslint.config.mjs",
  // Shared invitation policy is dependency-free apart from the root Zod SDK.
  "functions/mio-sms/src", "functions/mio-sms/package.json", "functions/mio-sms/tsconfig.json",
];
const destination = resolve(".appwrite/site");
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
for (const path of sourcePaths) {
  if (!existsSync(path)) throw new Error(`Deployment source is missing: ${path}`);
  mkdirSync(dirname(resolve(destination, path)), { recursive: true });
  cpSync(path, resolve(destination, path), { recursive: true, dereference: false });
}
// The package scripts can remain useful locally without pointing the deployed
// package at tests and provisioning scripts that are intentionally not shipped.
const packagePath = resolve(destination, "package.json");
const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
manifest.scripts = { build: "next build", start: "next start" };
writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Prepared Appwrite upload from application source only.");
