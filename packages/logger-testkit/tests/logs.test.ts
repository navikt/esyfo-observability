import pino from "pino";
import { describe, expect, it } from "vitest";
import { assertLogEvent, assertLogEvents, createLogCapture, parseLogs } from "../src/index.js";

const event = { name: "plan_fetch_failed", level: "error", message: "Kunne ikke hente oppfølgingsplan" } as const;
const record = { event_type: event.name, level: "ERROR", message: event.message, error_code: "NETWORK_ERROR" };

describe("serialized log assertions", () => {
  it.each([true, false, null, "private-fixture"])("rejects incomplete context even if the remaining event is valid", (marker) => {
    const output = JSON.stringify({ ...record, logging_context_invalid: marker });
    expect(() => assertLogEvent(output, { event })).toThrow(/logging_context_invalid/);
    try { assertLogEvent(output, { event }); } catch (error) {
      expect(String(error)).not.toContain("private-fixture");
    }
  });

  it("captures the actual Pino destination and checks the chosen event", () => {
    const capture = createLogCapture();
    const logger = pino({ messageKey: "message" }, capture.destination);
    logger.error({ event_type: event.name, error_code: "NETWORK_ERROR" }, event.message);
    assertLogEvent(capture.text(), { event, context: { error_code: "NETWORK_ERROR" } });
  });

  it("decodes UTF-8 split across writes", () => {
    const capture = createLogCapture();
    const bytes = Buffer.from(JSON.stringify(record) + "\n");
    for (const byte of bytes) capture.destination.write(Buffer.from([byte]));
    expect(parseLogs(capture.text())[0]?.message).toBe(event.message);
  });

  it("never turns empty output or empty expectations into evidence", () => {
    expect(() => assertLogEvent("", { event })).toThrow(/Expected 1/);
    expect(() => assertLogEvents("", [])).toThrow(/at least one/);
  });

  it("fails on an additional unmarked error instead of filtering it away", () => {
    const output = JSON.stringify(record) + "\n" + JSON.stringify({ level: "ERROR", message: "Second failure" });
    expect(() => assertLogEvent(output, { event })).toThrow(/Expected 1/);
  });

  it("checks message and level per event, accepting expected INFO events", () => {
    expect(() => assertLogEvent(JSON.stringify({ ...record, level: "WARN" }), { event })).toThrow(/level/);
    expect(() => assertLogEvent(JSON.stringify({ ...record, message: "" }), { event })).toThrow(/message/);
    const expected = { name: "plan_not_found", level: "info", message: "Planen finnes ikke" } as const;
    assertLogEvent(JSON.stringify({ event_type: expected.name, level: 30, msg: expected.message }), { event: expected });
  });

  it("checks active trace identity, not merely the format", () => {
    const traceId = "1234567890abcdef1234567890abcdef";
    assertLogEvent(JSON.stringify({ ...record, trace_id: traceId }), { event, traceId });
    expect(() => assertLogEvent(JSON.stringify(record), { event, traceId })).toThrow(/trace_id/);
    expect(() => assertLogEvent(JSON.stringify({ ...record, trace_id: "a".repeat(32) }), { event, traceId })).toThrow(/trace_id/);
  });

  it("rejects invalid schema values without logging their contents", () => {
    const privateValue = "private-fixture-value";
    const output = JSON.stringify({ ...record, upstream_status: privateValue });
    expect(() => assertLogEvent(output, { event })).toThrow(/upstream_status/);
    try { assertLogEvent(output, { event }); } catch (error) {
      expect(String(error)).not.toContain(privateValue);
    }
  });

  it("preserves and asserts nested PDL diagnostic fields", () => {
    const errors = [{ message: "Technical upstream error", extensions: { code: "server_error" } }];
    assertLogEvent(JSON.stringify({ ...record, pdl_errors: errors }), {
      event, context: { pdl_errors: errors }, contains: ["Technical upstream error"], excludes: ["private-fixture"],
    });
  });

  it("finds privacy fixtures even through escaped JSON and exception causes", () => {
    const output = JSON.stringify({ ...record, err: { cause: { message: "private-fixture" } } }).replace("private-fixture", "\\u0070rivate-fixture");
    expect(() => assertLogEvent(output, { event, excludes: ["private-fixture"] })).toThrow(/Forbidden/);
    try { assertLogEvent(output, { event, excludes: ["private-fixture"] }); } catch (error) {
      expect(String(error)).not.toContain("private-fixture");
    }
  });

  it("rejects duplicate JSON keys, including nested and escaped keys", () => {
    for (const output of ['{"event_type":"one","event_type":"two"}', '{"a":{"x":1,"x":2}}', '{"x":1,"\\u0078":2}']) {
      expect(() => parseLogs(output)).toThrow(/Duplicate/);
    }
  });

  it("compares decoded diagnostic and privacy strings containing quotes or line breaks", () => {
    const diagnostic = 'Connection failed:\nupstream "fixture"';
    const output = JSON.stringify({ ...record, stack_trace: diagnostic });
    assertLogEvent(output, { event, contains: [diagnostic] });
    expect(() => assertLogEvent(output, { event, excludes: [diagnostic] })).toThrow(/Forbidden/);
  });

  it("rejects malformed JSON without echoing its content", () => {
    for (const input of ['{"token":"private-fixture",}', '/* comment */{}', '{"x":1} trailing', '[1]', 'null']) {
      expect(() => parseLogs(input)).toThrow();
      try { parseLogs(input); } catch (error) { expect(String(error)).not.toContain("private-fixture"); }
    }
  });

  it("checks separately expected attempt outcomes in order", () => {
    const retry = { name: "plan_retry_scheduled", level: "warn", message: "Prøver igjen senere" } as const;
    const output = JSON.stringify(record) + "\n" + JSON.stringify({ event_type: retry.name, level: "WARN", message: retry.message });
    assertLogEvents(output, [{ event }, { event: retry }]);
  });
});
