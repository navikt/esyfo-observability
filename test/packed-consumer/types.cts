import logger = require("@navikt/esyfo-logger");

const event = logger.defineEvent<{ error_code: "NETWORK_ERROR" }>({
  name: "plan_fetch_failed", level: "error", message: "Kunne ikke hente oppfølgingsplan",
});
const native: logger.NativeLogger = {
  info() {}, warn() {}, error() {}, fatal() {},
};
logger.createEventLogger(native).event(event, { error_code: "NETWORK_ERROR" });
// @ts-expect-error The CommonJS declaration must also preserve context types.
logger.createEventLogger(native).event(event, { error_code: "TYPO" });

const application = logger.createLogger({ ...native, debug() {} });
application.event(event, { error_code: "NETWORK_ERROR" });
application.info("Jobben starter", { attempt: 1 });
application.debug("Behandler neste side", { page: 2, optional: undefined });
// @ts-expect-error CommonJS retains reserved diagnostic field protection.
application.info("Jobben starter", { trace_id: "1234567890abcdef1234567890abcdef" });
// @ts-expect-error CommonJS retains the primitive-only diagnostic restriction.
application.debug("Behandler neste side", { payload: [1, 2] });
// @ts-expect-error Errors require typed events in CommonJS as well.
application.error("Kunne ikke hente plan");
