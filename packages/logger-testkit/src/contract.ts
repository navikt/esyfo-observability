import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv, type ValidateFunction } from "ajv";
import type { LogRecord } from "./parse.js";

let validator: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  if (!validator) {
    const directory = new URL("../contracts/runtime-error/v1.0.0/", import.meta.url);
    const bytes = readFileSync(new URL("schema.json", directory));
    const expected = "f48387c964ff6779fd7857a4bdc18bb459521a0325d3d4141a5e12aba8099190";
    if (createHash("sha256").update(bytes).digest("hex") !== expected) {
      throw new Error("The packaged runtime error contract v1.0.0 checksum does not match");
    }
    validator = new Ajv({ strict: true, allErrors: true }).compile(JSON.parse(bytes.toString("utf8")));
  }
  return validator;
}

export function assertContract(record: LogRecord, index: number): void {
  const validate = getValidator();
  if (!validate(record)) {
    const errors = (validate.errors ?? []).map(({ instancePath, keyword }) => `${instancePath || "/"} (${keyword})`);
    throw new Error(`Log record ${index + 1}: Invalid contract fields: ${errors.join(", ")}`);
  }
}
