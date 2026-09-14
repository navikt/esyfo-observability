import assert from "node:assert/strict";
import pino from "pino";
import { apiRequestRejected, createLogger, defineEvent } from "@navikt/esyfo-logger";
import { assertLogEvent, createLogCapture, parseLogs } from "@navikt/esyfo-logger-testkit";

const capture = createLogCapture();
const log = createLogger(pino({}, capture.destination));
const failed = defineEvent({
  name: "plan_fetch_failed", level: "error", message: "Kunne ikke hente oppfølgingsplan",
});
log.event(failed, { error_code: "NETWORK_ERROR" }, new Error("Request failed", {
  cause: new Error("Connection closed"),
}));
assertLogEvent(capture.text(), {
  event: failed,
  context: { error_code: "NETWORK_ERROR" },
  contains: ["Request failed", "Connection closed"],
});
assert.equal(apiRequestRejected({ operation: "hent_plan", message: "Tilgang avvist" }).level, "warn");

const diagnostics = createLogCapture();
const applicationLog = createLogger(pino({ level: "debug" }, diagnostics.destination));
applicationLog.info("Jobben starter", { attempt: 1, omitted: undefined });
applicationLog.debug("Behandler neste side", { page: 2 });
const records = parseLogs(diagnostics.text());
assert.equal(records.length, 2);
assert.equal(records[0].msg, "Jobben starter");
assert.equal(records[0].attempt, 1);
assert.equal(Object.hasOwn(records[0], "omitted"), false);
assert.equal(records[1].level, 20);
assert.equal(records[1].page, 2);
applicationLog.info("Jobben starter", { attempt: 2, ratio: NaN, error_code: "UNKNOWN" });
applicationLog.debug("Jobben starter", new Error("Private fixture"));
const incomplete = parseLogs(diagnostics.text()).slice(2);
assert.equal(incomplete.length, 2);
assert.equal(incomplete[0].attempt, 2);
assert.equal(incomplete[0].logging_context_invalid, true);
assert.equal(Object.hasOwn(incomplete[0], "ratio"), false);
assert.equal(Object.hasOwn(incomplete[0], "error_code"), false);
assert.equal(incomplete[1].logging_context_invalid, true);
assert.equal(diagnostics.text().includes("Private fixture"), false);
const damagedEvent = createLogCapture();
createLogger(pino({}, damagedEvent.destination)).event(failed, { trace_id: "private-fixture" });
assert.throws(() => assertLogEvent(damagedEvent.text(), { event: failed }), /logging_context_invalid/);
console.log("Packed ESM logger and testkit preserve events, primitive diagnostics and native cause");
