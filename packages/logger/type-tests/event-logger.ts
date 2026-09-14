import {
  apiRequestRejected,
  createEventLogger,
  defineEvent,
  type Event,
  type NativeLogger,
} from "../src/index.js";

declare const nativeLogger: NativeLogger;
const log = createEventLogger(nativeLogger);
const definition = {
  name: "plan_fetch_failed",
  level: "error",
  message: "Kunne ikke hente oppfølgingsplan",
  operation: "hent_plan",
} as const;
const planHentingFeilet = defineEvent<{
  error_code: "NETWORK_ERROR" | "INVALID_RESPONSE";
  network_cause?: "DNS_LOOKUP_FAILED" | "TIMEOUT";
}>(definition);

log.event(planHentingFeilet, { error_code: "NETWORK_ERROR" });
log.event(
  planHentingFeilet,
  { error_code: "NETWORK_ERROR", network_cause: "DNS_LOOKUP_FAILED" },
  new Error("Reviewed diagnostic"),
);

// @ts-expect-error The log call must not widen the event's code union.
log.event(planHentingFeilet, { error_code: "UNKNOWN_CODE" });

// @ts-expect-error Required context must be supplied.
log.event(planHentingFeilet, {});

// @ts-expect-error Misspelled context keys are not allowed.
log.event(planHentingFeilet, { error_code: "NETWORK_ERROR", error_cod: "NETWORK_ERROR" });

const extraContext = {
  error_code: "NETWORK_ERROR",
  token: "private-canary",
} as const;
// @ts-expect-error Extra keys are also rejected when supplied through a variable.
log.event(planHentingFeilet, extraContext);

// @ts-expect-error Native error diagnostics use the separate cause argument.
log.event(planHentingFeilet, { error_code: "NETWORK_ERROR", err: new Error() });

// @ts-expect-error A cause must be an Error, not an arbitrary client response.
log.event(planHentingFeilet, { error_code: "NETWORK_ERROR" }, { response: "private-canary" });

// @ts-expect-error Definitions cannot reserve a context field for the severity.
defineEvent<{ error_code: "NETWORK_ERROR"; level: string }>(definition);
// @ts-expect-error Event context cannot replace the adapter's validation marker.
defineEvent<{ logging_context_invalid: boolean }>(definition);

// @ts-expect-error Open dictionaries defeat a closed context declaration.
defineEvent<Record<string, unknown>>(definition);

// @ts-expect-error Array/index contexts are not a closed set of named log fields.
defineEvent<string[]>(definition);

declare const privateField: unique symbol;
// @ts-expect-error Symbol context fields do not survive JSON serialization.
defineEvent<{ [privateField]: string }>(definition);

// @ts-expect-error A wider event type must not erase its required context.
const widened: Event<{}> = planHentingFeilet;

const rejection = apiRequestRejected<{
  rejection_reason: "NOT_AUTHORIZED" | "PLAN_NOT_FOUND";
}>({ operation: "hent_plan", message: "Oppfølgingsplan kunne ikke vises" });
log.event(rejection, { rejection_reason: "NOT_AUTHORIZED" });

// @ts-expect-error Rejection reasons are owned by this event, not inferred from the call.
log.event(rejection, { rejection_reason: "ARBITRARY_REASON" });

// @ts-expect-error A common rejection event must declare its reason.
apiRequestRejected<{ upstream_status: number }>({ operation: "hent_plan", message: "Avvist" });

// @ts-expect-error A common rejection always binds a logical operation.
apiRequestRejected<{ rejection_reason: "NOT_AUTHORIZED" }>({ message: "Avvist" });

// @ts-expect-error The shared rejection definition fixes its severity.
apiRequestRejected<{ rejection_reason: "NOT_AUTHORIZED" }>({ operation: "hent_plan", message: "Avvist", level: "error" });

// @ts-expect-error Event metadata is immutable.
planHentingFeilet.message = "A different explanation";

const validationOrNetwork = defineEvent<
  | { error_code: "NETWORK_ERROR"; network_cause: "TIMEOUT" }
  | { error_code: "INVALID_RESPONSE"; validation_issue_count: number }
>(definition);
log.event(validationOrNetwork, { error_code: "NETWORK_ERROR", network_cause: "TIMEOUT" });
log.event(validationOrNetwork, { error_code: "INVALID_RESPONSE", validation_issue_count: 2 });

// @ts-expect-error Context must retain the relationship between code and diagnostic fields.
log.event(validationOrNetwork, { error_code: "NETWORK_ERROR", validation_issue_count: 2 });

// @ts-expect-error A diagnostic from the other union branch is still an extra field.
log.event(validationOrNetwork, { error_code: "NETWORK_ERROR", network_cause: "TIMEOUT", validation_issue_count: 2 });
