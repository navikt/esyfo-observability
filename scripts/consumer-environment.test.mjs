import assert from "node:assert/strict";
import { test } from "node:test";
import { consumerEnvironment } from "./consumer-environment.mjs";

test("isolated package installation does not inherit registry tokens or npm configuration", () => {
  const keys = ["NODE_AUTH_TOKEN", "NPM_AUTH_TOKEN", "NPM_TOKEN", "GITHUB_TOKEN", "GH_TOKEN",
    "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "npm_config_userconfig", "NPM_CONFIG_REGISTRY",
    "PNPM_CONFIG__AUTH", "pnpm_config_npmrc_auth_file"];
  const input = Object.fromEntries(keys.map((key) => [key, "synthetic-credential"]));
  input.PATH = "/example/bin";
  input.LANG = "nb_NO.UTF-8";
  assert.deepEqual(consumerEnvironment(input), { PATH: "/example/bin", LANG: "nb_NO.UTF-8" });
  assert.equal(Object.keys(input).length, keys.length + 2, "Do not mutate the caller's environment");
});
