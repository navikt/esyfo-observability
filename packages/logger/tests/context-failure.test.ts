import pino from "pino";
import { describe, expect, it } from "vitest";
import { createLogger, defineEvent } from "../src/index.js";

describe("runtime context failures", () => {
  it("distinguishes missing required event context from optional diagnostic fields", () => {
    const lines: string[] = [];
    const log = createLogger(pino({ base: null, timestamp: false }, { write: (line) => lines.push(line) }));
    const event = defineEvent<{}>({ name: "plan_fetch_failed", level: "error", message: "Could not fetch plan" });

    log.info("Job completed");
    log.event(event, undefined as never);
    log.event(event, {});

    const records = lines.map((line) => JSON.parse(line));
    expect(records).toHaveLength(3);
    expect(records[0]).not.toHaveProperty("logging_context_invalid");
    expect(records[1]).toHaveProperty("logging_context_invalid", true);
    expect(records[2]).not.toHaveProperty("logging_context_invalid");
  });

  it("keeps application flow and valid fields when a diagnostic number is not finite", () => {
    const lines: string[] = [];
    const log = createLogger(pino({ base: null, timestamp: false }, { write: (line) => lines.push(line) }));
    const completeJob = () => {
      log.info("Job completed", { count: 0, ratio: 0 / 0 });
      return "completed";
    };

    expect(completeJob()).toBe("completed");
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { level: 30, msg: "Job completed", count: 0, logging_context_invalid: true },
    ]);
  });

  it("does not read context at disabled native levels", () => {
    const lines: string[] = [];
    const log = createLogger(pino({ level: "error" }, { write: (line) => lines.push(line) }));
    let reads = 0;
    const fields = { get count(): number { reads++; throw new Error("Disabled context was read"); } };
    const event = defineEvent<typeof fields>({ name: "job_progress", level: "info", message: "Job progress" });

    log.debug("Job progress", fields);
    log.info("Job progress", fields);
    log.event(event, fields);

    expect(reads).toBe(0);
    expect(lines).toEqual([]);
  });

  it("keeps the original failure, trace and readable event fields when one field getter fails", () => {
    const lines: string[] = [];
    const original = new Error("Original upstream failure");
    let serializedCause: unknown;
    const log = createLogger(pino({
      base: null,
      timestamp: false,
      mixin: () => ({ trace_id: "0123456789abcdef0123456789abcdef" }),
      serializers: { err(error) { serializedCause = error; return pino.stdSerializers.err(error); } },
    }, { write: (line) => lines.push(line) }));
    const context = {
      error_code: "NETWORK_ERROR" as const,
      upstream_status: 503,
      get detail(): string { throw new Error("private-context-canary"); },
    };
    const event = defineEvent<typeof context>({ name: "plan_fetch_failed", level: "error", message: "Could not fetch plan" });
    const operation = () => {
      try { throw original; } catch (error) {
        log.event(event, context, error as Error);
        return "existing fallback";
      }
    };

    expect(operation()).toBe("existing fallback");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 50, msg: event.message, event_type: event.name, error_code: "NETWORK_ERROR",
      upstream_status: 503, trace_id: "0123456789abcdef0123456789abcdef", logging_context_invalid: true,
    });
    expect(serializedCause).toBe(original);
    expect(lines[0]).toContain("Original upstream failure");
    expect(lines[0]).not.toContain("private-context-canary");
    expect(JSON.parse(lines[0]!)).not.toHaveProperty("detail");
  });

  it("does not catch failures from the native encoder", () => {
    const failure = new Error("Native encoder failed");
    const log = createLogger(pino({ formatters: { log() { throw failure; } } }));
    const event = defineEvent<{}>({ name: "plan_fetch_failed", level: "error", message: "Could not fetch plan" });

    expect(() => log.info("Job completed", { count: 1 })).toThrow(failure);
    expect(() => log.event(event, {})).toThrow(failure);
  });
});
