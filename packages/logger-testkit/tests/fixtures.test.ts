import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertContract } from "../src/contract.js";
import { parseLogs } from "../src/index.js";

const fixtures: { name: string; valid: boolean; json: string }[] = JSON.parse(readFileSync(
  new URL("../../../contracts/runtime-error/fixtures/v1.json", import.meta.url), "utf8",
));

describe("shared Node/JVM contract fixtures", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const validate = () => assertContract(parseLogs(fixture.json)[0]!, 0);
      if (fixture.valid) expect(validate).not.toThrow();
      else expect(validate).toThrow();
    });
  }
});
