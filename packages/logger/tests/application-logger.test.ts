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
    "pid", "hostname", "name",
  ])("rejects diagnostic metadata that replaces %s", (field) => {
    const lines: string[] = [];
    const log = createLogger(pino({ level: "debug" }, { write: (line) => lines.push(line) }));

    for (const method of [log.info, log.debug]) {
      expect(() => method("Jobben starter", { [field]: "private-canary" } as never))
        .toThrow(`Diagnostic fields must not set reserved field: ${field}`);
    }
    expect(lines).toEqual([]);
  });

  it.each([
    new Error("private-canary"), ["private-canary"], new Date(), null,
    { detail: new Error("private-canary") }, { detail: { token: "private-canary" } },
    { detail: ["private-canary"] }, { detail: () => "private-canary" },
    { detail: Symbol("private-canary") }, { detail: 1n },
    { count: Number.NaN }, { count: Number.POSITIVE_INFINITY },
  ])("rejects non-primitive diagnostic data without serializing or exposing it", (fields) => {
    const lines: string[] = [];
    const log = createLogger(pino({ level: "debug" }, { write: (line) => lines.push(line) }));

    expect(() => log.info("Jobben starter", fields as never))
      .toThrow("Diagnostic fields must be a plain object containing only JSON primitives");
    expect(lines).toEqual([]);
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

  it.each(["", "  ", null, undefined, 503, new Error("private-canary"), { token: "private-canary" }])(
    "rejects a missing or non-text diagnostic message",
    (message) => {
      const lines: string[] = [];
      const log = createLogger(pino({ level: "debug" }, { write: (line) => lines.push(line) }));
      for (const method of [log.info, log.debug]) {
        expect(() => method(message as never)).toThrow("Diagnostic message must be a non-empty string");
      }
      expect(lines).toEqual([]);
    },
  );

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
