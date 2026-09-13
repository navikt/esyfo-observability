const assert = require("node:assert/strict");
const pino = require("pino");
const { createEventLogger, defineEvent } = require("@navikt/esyfo-logger");

let output = "";
const native = pino({}, { write(chunk) { output += chunk; } });
createEventLogger(native).event(defineEvent({
  name: "plan_fetch_failed", level: "error", message: "Kunne ikke hente oppfølgingsplan",
}), { error_code: "NETWORK_ERROR" });
assert.equal(JSON.parse(output).event_type, "plan_fetch_failed");
console.log("Packed CommonJS runtime resolves and emits through native Pino");
