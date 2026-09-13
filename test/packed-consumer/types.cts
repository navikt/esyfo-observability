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
