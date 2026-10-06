import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

for (const kind of ["function", "site"]) {
  execFileSync("node", [`scripts/prepare-${kind}.mjs`], { stdio: "inherit" });
  const directory = `.appwrite/${kind}`;
  function check(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name.startsWith(".env") || entry.name === "node_modules" || entry.isSymbolicLink()) throw new Error(`Unsafe archive entry: ${join(path, entry.name)}`);
      if (entry.isDirectory()) check(join(path, entry.name));
    }
  }
  check(directory);
  execFileSync("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], { cwd: directory, stdio: "inherit" });
  execFileSync("pnpm", ["build"], { cwd: directory, stdio: "inherit" });
}
console.log("Both exact source archives pass isolated frozen install and production build; no secrets shipped.");
