import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";

const source = new URL("../../../contracts/runtime-error/v1.0.0/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("source.json", source), "utf8"));
for (const [file, hash] of Object.entries(manifest.files)) {
  assert.equal(createHash("sha256").update(readFileSync(new URL(file, source))).digest("hex"), hash,
    `Changed immutable contract file: ${file}`);
}
const target = new URL("../contracts/runtime-error/v1.0.0/", import.meta.url);
mkdirSync(target, { recursive: true });
for (const file of ["schema.json", "source.json", "SHA256SUMS.txt"]) {
  cpSync(new URL(file, source), new URL(file, target));
}
