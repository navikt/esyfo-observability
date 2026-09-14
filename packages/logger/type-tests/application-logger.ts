import { createLogger, type NativeApplicationLogger } from "../src/index.js";

declare const native: NativeApplicationLogger;
const log = createLogger(native);

log.info("Jobben starter");
log.debug("Behandler neste side", { page: 2, cached: false, source: "batch", cursor: null });
const optionalFields: { count?: number; source: string | undefined } = { source: undefined };
log.info("Jobben er ferdig", optionalFields);

// @ts-expect-error Ordinary diagnostics must not impersonate a classified error.
log.info("Jobben starter", { error_code: "UPSTREAM_ERROR" });
// @ts-expect-error Only the adapter may report incomplete context.
log.info("Jobben starter", { logging_context_invalid: false });
// @ts-expect-error Native trace context is not owned by the caller.
log.debug("Behandler neste side", { trace_id: "1234567890abcdef1234567890abcdef" });
const collision = { count: 1, event_type: "other_event" };
// @ts-expect-error Reserved keys must also be rejected through variables.
log.info("Jobben starter", collision);
// @ts-expect-error Warnings must be a typed event.
log.warn("Tilgang avvist");
// @ts-expect-error Errors must be a typed event.
log.error("Kunne ikke hente plan");

// @ts-expect-error Error diagnostics belong to a typed event's separate cause argument.
log.info("Jobben starter", new Error("Unsafe client detail"));
// @ts-expect-error Nested objects are not ordinary diagnostic fields.
log.debug("Behandler neste side", { request: { authorization: "private" } });
// @ts-expect-error Arrays are not primitive field values.
log.info("Jobben starter", { values: [1, 2] });
// @ts-expect-error Functions are not serialized diagnostic values.
log.info("Jobben starter", { value: () => 1 });
// @ts-expect-error Unrestricted dictionaries cannot prove the absence of reserved keys.
log.info("Jobben starter", {} as Record<string, string>);
declare const symbolKey: unique symbol;
// @ts-expect-error Symbols do not survive JSON serialization.
log.debug("Behandler neste side", { [symbolKey]: "private" });
// @ts-expect-error Record-wide arrays are not diagnostic fields.
log.info("Jobben starter", [1, 2]);
// @ts-expect-error A nested Error is not a primitive value.
log.debug("Behandler neste side", { detail: new Error("Unsafe client detail") });
// @ts-expect-error The message cannot be a raw Error or another object.
log.info(new Error("Unsafe client detail"));
