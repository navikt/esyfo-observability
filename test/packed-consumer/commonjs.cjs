const assert = require("node:assert/strict");
const pino = require("pino");
const { createEventLogger, createLogger, defineEvent } = require("@navikt/esyfo-logger");

let output = "";
const native = pino({ level: "debug" }, { write(chunk) { output += chunk; } });
createEventLogger(native).event(defineEvent({
  name: "plan_fetch_failed", level: "error", message: "Kunne ikke hente oppfølgingsplan",
}), { error_code: "NETWORK_ERROR" });
assert.equal(JSON.parse(output).event_type, "plan_fetch_failed");
output = "";
const log = createLogger(native);
log.info("Jobben starter", { attempt: 1 });
log.debug("Behandler neste side", { page: 2 });
const records = output.trim().split("\n").map(JSON.parse);
assert.equal(records[0].attempt, 1);
assert.equal(records[1].level, 20);
assert.equal(records[1].page, 2);
output = "";
log.info("Jobben starter", { attempt: 1, ratio: NaN });
assert.equal(JSON.parse(output).attempt, 1);
assert.equal(JSON.parse(output).logging_context_invalid, true);
assert.equal(Object.hasOwn(JSON.parse(output), "ratio"), false);
console.log("Packed CommonJS runtime resolves the unified and existing event-only entry points");
