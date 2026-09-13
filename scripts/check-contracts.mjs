import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const directory = new URL("../contracts/runtime-error/v1.0.0/", import.meta.url);
const source = JSON.parse(readFileSync(new URL("source.json", directory), "utf8"));
const sums = readFileSync(new URL("SHA256SUMS.txt", directory), "utf8");
for (const [file, expected] of Object.entries(source.files)) {
  const bytes = readFileSync(new URL(file, directory));
  const actual = createHash("sha256").update(bytes).digest("hex");
  assert.equal(actual, expected, `Published contract bytes changed: ${file}`);
  assert.ok(sums.split(/\r?\n/).includes(`${expected}  ${file}`), `Missing checksum: ${file}`);
}
const schema = JSON.parse(readFileSync(new URL("schema.json", directory), "utf8"));
assert.equal(schema.$id, source.url, "The existing v1 schema identity must remain unchanged");
console.log("Runtime error contract v1.0.0: original bytes and identity verified.");
