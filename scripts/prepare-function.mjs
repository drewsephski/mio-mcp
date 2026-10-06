import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

execFileSync("pnpm", ["sms:build"], { stdio: "inherit" });
const destination = resolve(".appwrite/function");
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
for (const path of ["src", "tsconfig.json", "package.json"]) cpSync(resolve("functions/mio-sms", path), resolve(destination, path), { recursive: true });
// Keep the resolved workspace versions while mapping the Function importer to
// its isolated deployment root. No environment files enter this allowlist.
const lock = readFileSync("pnpm-lock.yaml", "utf8");
const importer = lock.match(/\n  functions\/mio-sms:\n([\s\S]*?)(?=\n\S|\n  [^ ]|$)/)?.[1];
if (!importer) throw new Error("SMS workspace lockfile importer is missing");
writeFileSync(resolve(destination, "pnpm-lock.yaml"), lock.replace(/importers:\n[\s\S]*?(?=\npackages:)/, `importers:\n\n  .:\n${importer}\n`));
// Frozen installation checks the override configuration even when an override
// targets an unrelated workspace. Preserve it verbatim from this same lock.
const overrides = lock.match(/^overrides:\n(?:[ \t]+.*\n)*/m)?.[0] ?? "";
writeFileSync(resolve(destination, "pnpm-workspace.yaml"), `packages:\n  - "."\n${overrides}`);
console.log("Prepared SMS Function source and locked dependencies; no secrets included.");
