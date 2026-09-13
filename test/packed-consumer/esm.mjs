import assert from "node:assert/strict";
import pino from "pino";
import { apiRequestRejected, createEventLogger, defineEvent } from "@navikt/esyfo-logger";
import { assertLogEvent, createLogCapture } from "@navikt/esyfo-logger-testkit";

const capture = createLogCapture();
const log = createEventLogger(pino({}, capture.destination));
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
console.log("Packed ESM runtime and testkit preserve structured fields and native cause");
