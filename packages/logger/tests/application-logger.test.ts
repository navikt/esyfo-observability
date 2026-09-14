import pino from "pino";
import { describe, expect, it } from "vitest";
import { createLogger, defineEvent } from "../src/index.js";

describe("application logger", () => {
  it("writes ordinary diagnostics and a typed failure through the same native logger", () => {
    const lines: string[] = [];
    const native = pino({ base: null, timestamp: false, level: "debug" }, {
      write: (line) => lines.push(line),
    }).child({ app: "plan-service" });
    const log = createLogger(native);
    const failed = defineEvent<{ error_code: "UPSTREAM_ERROR" }>({
      name: "plan_fetch_failed", level: "error", message: "Kunne ikke hente plan",
    });

    log.info("Jobben starter");
    log.debug("Behandler neste side", { page: 2, cached: false, cursor: null, source: "batch" });
    log.event(failed, { error_code: "UPSTREAM_ERROR" });

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { app: "plan-service", level: 30, msg: "Jobben starter" },
      { app: "plan-service", level: 20, msg: "Behandler neste side", page: 2, cached: false, cursor: null, source: "batch" },
      { app: "plan-service", level: 50, msg: "Kunne ikke hente plan", event_type: "plan_fetch_failed", error_code: "UPSTREAM_ERROR" },
    ]);
    expect(log).not.toHaveProperty("warn");
    expect(log).not.toHaveProperty("error");
    expect(log).not.toHaveProperty("fatal");
  });

  it.each([
    "event_type", "operation", "error_code", "rejection_reason", "level", "message", "msg",
    "err", "cause", "trace_id", "span_id", "trace_flags", "logger_name", "time", "timestamp",
    "pid", "hostname", "name", "logging_context_invalid",
  ])("omits diagnostic metadata that replaces %s and marks the record", (field) => {
    const lines: string[] = [];
    const log = createLogger(pino({ level: "debug" }, { write: (line) => lines.push(line) }));

    for (const method of [log.info, log.debug]) {
      method("Jobben starter", { count: 2, [field]: "private-canary" } as never);
    }
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(JSON.parse(line)).toMatchObject({ count: 2, msg: "Jobben starter", logging_context_invalid: true });
      expect(line).not.toContain("private-canary");
    }
  });

  it.each([
    new Error("private-canary"), ["private-canary"], new Date(), null,
    { detail: new Error("private-canary") }, { detail: { token: "private-canary" } },
    { detail: ["private-canary"] }, { detail: () => "private-canary" },
    { detail: Symbol("private-canary") }, { detail: 1n },
    { count: Number.NaN }, { count: Number.POSITIVE_INFINITY },
  ])("marks unsupported diagnostic data without serializing or exposing it", (fields) => {
    const lines: string[] = [];
    const log = createLogger(pino({ level: "debug" }, { write: (line) => lines.push(line) }));

    log.info("Jobben starter", fields as never);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ msg: "Jobben starter", logging_context_invalid: true });
    expect(JSON.parse(lines[0]!)).not.toHaveProperty("detail");
    expect(JSON.parse(lines[0]!)).not.toHaveProperty("count");
    expect(lines[0]).not.toContain("private-canary");
  });

  it("omits undefined before native formatting without mutating the caller's object", () => {
    const lines: string[] = [];
    let receivedFields: object | undefined;
    const log = createLogger(pino({
      base: null,
      timestamp: false,
      formatters: { log(fields) { receivedFields = fields; return fields; } },
    }, { write: (line) => lines.push(line) }));
    const fields = { count: undefined, cached: false, cursor: null };

    log.info("Jobben starter", fields);

    expect(receivedFields).toStrictEqual({ cached: false, cursor: null });
    expect(fields).toHaveProperty("count", undefined);
    expect(JSON.parse(lines[0]!)).toEqual({ level: 30, msg: "Jobben starter", cached: false, cursor: null });
  });

  it.each([null, undefined, 503, new Error("private-canary"), { token: "private-canary" }])(
    "marks a non-text diagnostic message without stringifying its value",
    (message) => {
      const lines: string[] = [];
      const log = createLogger(pino({ level: "debug" }, { write: (line) => lines.push(line) }));
      for (const method of [log.info, log.debug]) {
        method(message as never);
      }
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(JSON.parse(line)).toMatchObject({ msg: "Invalid diagnostic message", logging_context_invalid: true });
        expect(line).not.toContain("private-canary");
      }
    },
  );

  it.each(["", "  "])("passes a type-valid blank message through to the native logger", (message) => {
    const lines: string[] = [];
    const log = createLogger(pino({}, { write: (line) => lines.push(line) }));
    log.info(message);
    expect(JSON.parse(lines[0]!)).toHaveProperty("msg", message);
    expect(JSON.parse(lines[0]!)).not.toHaveProperty("logging_context_invalid");
  });

  it("keeps native debug filtering and permits destructured application methods", () => {
    const lines: string[] = [];
    const { info, debug } = createLogger(pino({ base: null, timestamp: false }, {
      write: (line) => lines.push(line),
    }));
    debug("Behandler neste side", { page: 2 });
    info("Jobben starter");
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ level: 30, msg: "Jobben starter" }]);
  });
});
