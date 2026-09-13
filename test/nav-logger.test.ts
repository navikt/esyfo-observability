import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { context, trace } from "@opentelemetry/api";
import { backendLogger } from "@navikt/next-logger";
import { createLogger } from "@navikt/pino-logger";
import { afterEach, describe, expect, it } from "vitest";
import { apiRequestRejected, createEventLogger, defineEvent } from "../packages/logger/src/index.js";
import { assertLogEvent, createLogCapture } from "../packages/logger-testkit/src/index.js";

const planFailed = defineEvent<{ error_code: "NETWORK_ERROR" }>({
  name: "plan_fetch_failed", level: "error", message: "Kunne ikke hente oppfølgingsplan",
});

afterEach(() => { trace.disable(); context.disable(); });

for (const [name, factory] of [["NAV Pino", createLogger], ["Next backendLogger", backendLogger]] as const) {
  describe(name, () => {
    it("preserves the native error, readable message and actual async span context", async () => {
      const manager = new AsyncLocalStorageContextManager().enable();
      context.setGlobalContextManager(manager);
      const provider = new BasicTracerProvider();
      trace.setGlobalTracerProvider(provider);
      const capture = createLogCapture();
      const native = factory({}, capture.destination);
      const log = createEventLogger(native);
      let traceId = "";
      try {
        await provider.getTracer("logging-tests").startActiveSpan("fetch-plan", async (span) => {
          traceId = span.spanContext().traceId;
          await Promise.resolve();
          log.event(planFailed, { error_code: "NETWORK_ERROR" }, new Error("Request failed", {
            cause: new Error("Connection closed"),
          }));
          span.end();
        });
        assertLogEvent(capture.text(), {
          event: planFailed, context: { error_code: "NETWORK_ERROR" }, traceId,
          contains: ["Request failed", "Connection closed"],
        });
      } finally {
        await provider.shutdown();
        manager.disable();
      }
    });

    it("detects sensitive data actually present in an unsanitized native cause", () => {
      const capture = createLogCapture();
      const log = createEventLogger(factory({}, capture.destination));
      const sensitiveValue = "synthetic-private-token";
      log.event(planFailed, { error_code: "NETWORK_ERROR" }, new Error("Request failed", {
        cause: new Error(`Unsafe client detail: ${sensitiveValue}`),
      }));
      expect(() => assertLogEvent(capture.text(), {
        event: planFailed, excludes: [sensitiveValue],
      })).toThrow("Forbidden fixture value was emitted");
    });

    it("retains PDL diagnostics and the existing logger's configured redaction", () => {
      const capture = createLogCapture();
      const native = factory({ redact: ["err.request.headers.authorization"] }, capture.destination);
      const log = createEventLogger(native);
      const response = {
        errors: [{ message: "Technical upstream error", extensions: { code: "server_error" } }],
        data: { ident: "synthetic-private-person" },
      };
      const error = Object.assign(new Error("Request failed"), {
        request: { headers: { authorization: "synthetic-private-token" } },
      });
      const failed = defineEvent<{ pdl_errors: typeof response.errors }>({
        name: "person_fetch_failed", level: "error", message: "PDL returnerte feil ved personoppslag",
      });
      log.event(failed, { pdl_errors: response.errors }, error);
      assertLogEvent(capture.text(), {
        event: failed, context: { pdl_errors: response.errors },
        contains: ["Technical upstream error", "Request failed"],
        excludes: [response.data.ident, error.request.headers.authorization],
      });
    });

    it("supports an app-owned final rejection without changing its response", async () => {
      const capture = createLogCapture();
      const log = createEventLogger(factory({}, capture.destination));
      const rejected = apiRequestRejected<{ rejection_reason: "ACCESS_DENIED" }>({
        operation: "fetch_plan", message: "Tilgang til planen ble avvist",
      });
      async function request(primary: boolean, fallback: boolean): Promise<number> {
        if (primary || fallback) return 200;
        log.event(rejected, { rejection_reason: "ACCESS_DENIED" });
        return 403;
      }
      expect(await request(false, true)).toBe(200);
      expect(capture.text()).toBe("");
      expect(await request(false, false)).toBe(403);
      assertLogEvent(capture.text(), { event: rejected, context: { rejection_reason: "ACCESS_DENIED" } });
    });
  });
}
