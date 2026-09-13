import pino from "pino";
import { createEventLogger, defineEvent } from "@navikt/esyfo-logger";
import { assertLogEvent, createLogCapture } from "@navikt/esyfo-logger-testkit";

const capture = createLogCapture();
const log = createEventLogger(pino({}, capture.destination));
const failed = defineEvent<{ error_code: "NETWORK_ERROR" }>({
  name: "plan_fetch_failed", level: "error", message: "Kunne ikke hente oppfølgingsplan",
});
log.event(failed, { error_code: "NETWORK_ERROR" });
assertLogEvent(capture.text(), { event: failed, context: { error_code: "NETWORK_ERROR" } });

// @ts-expect-error The published declaration must retain the local code union.
log.event(failed, { error_code: "TYPO" });
// @ts-expect-error Required context is not optional in the published API.
log.event(failed, {});
const extra = { error_code: "NETWORK_ERROR", request: "private" } as const;
// @ts-expect-error Extra fields must also be rejected through variables.
log.event(failed, extra);
// @ts-expect-error Native trace context cannot be redefined by the event.
defineEvent<{ trace_id: string }>({ name: "failed", level: "error", message: "Failed" });
