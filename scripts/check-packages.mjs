import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { consumerEnvironment } from "./consumer-environment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = join(root, "artifacts/npm");
mkdirSync(destination, { recursive: true });
const dependencies = {};
for (const directory of ["logger", "logger-testkit"]) {
  const source = JSON.parse(readFileSync(join(root, "packages", directory, "package.json"), "utf8"));
  const archive = join(destination, `navikt-esyfo-${directory}-${source.version}.tgz`);
  execFileSync("pnpm", ["pack", "--out", archive], {
    cwd: join(root, "packages", directory), stdio: "inherit",
  });
  const entries = execFileSync("tar", ["-tf", archive], { encoding: "utf8" }).trim().split("\n");
  for (const required of ["package/package.json", "package/README.md", "package/LICENSE"]) {
    assert.ok(entries.includes(required), `Missing ${required} in ${source.name}`);
  }
  assert.ok(entries.every((entry) => /^package\/(dist\/|contracts\/|README\.md$|LICENSE$|package\.json$)/u.test(entry)),
    `Unexpected source or development files in ${source.name}`);
  const packed = JSON.parse(execFileSync("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" }));
  assert.equal(packed.name, source.name);
  assert.equal(packed.version, source.version);
  if (directory === "logger") assert.equal(Object.keys(packed.dependencies ?? {}).length, 0,
    "The runtime adapter must not add runtime dependencies");
  dependencies[source.name] = `file:${archive}`;
}

// Install only the archives and public test dependencies, outside the workspace.
const consumer = mkdtempSync(join(tmpdir(), "esyfo-logger-consumer-"));
cpSync(join(root, "test/packed-consumer"), consumer, { recursive: true });
const development = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies;
for (const name of ["pino", "typescript", "@types/node"]) dependencies[name] = development[name];
writeFileSync(join(consumer, "package.json"), JSON.stringify({
  name: "logging-package-consumer", private: true, type: "module", dependencies,
}, null, 2));

// Do not forward registry credentials or read personal npm configuration.
const environment = consumerEnvironment(process.env);
execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund",
  "--registry=https://registry.npmjs.org", "--userconfig=/dev/null",
  "--fetch-retries=0", "--fetch-timeout=20000",
  `--globalconfig=${join(consumer, "no-global-npmrc")}`,
], { cwd: consumer, env: environment, stdio: "inherit", timeout: 120_000 });
for (const script of ["esm.mjs", "commonjs.cjs", "node_modules/typescript/bin/tsc"]) {
  execFileSync(process.execPath, [script], { cwd: consumer, env: environment, stdio: "inherit" });
}
console.log("Packed consumer verified; these exact npm archives are ready for release checks");
