import pino from "pino";
import { describe, expect, it } from "vitest";
import {
  apiRequestRejected,
  createEventLogger,
  defineEvent,
  type EventDefinition,
} from "../src/index.js";

describe("application events", () => {
  it("writes one structured event through the existing logger", () => {
    const lines: string[] = [];
    const logger = pino({ base: null, timestamp: false }, { write: (line) => lines.push(line) });
    const planHentingFeilet = defineEvent<{
      error_code: "NETWORK_ERROR" | "INVALID_RESPONSE";
    }>({
      name: "plan_fetch_failed",
      level: "error",
      message: "Kunne ikke hente oppfølgingsplan",
      operation: "hent_plan",
    });

    createEventLogger(logger).event(planHentingFeilet, {
      error_code: "NETWORK_ERROR",
    });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      level: 50,
      msg: "Kunne ikke hente oppfølgingsplan",
      event_type: "plan_fetch_failed",
      operation: "hent_plan",
      error_code: "NETWORK_ERROR",
    });
  });

  it("keeps event metadata stable after the definition is created", () => {
    const definition = {
      name: "plan_fetch_failed",
      level: "error" as const,
      message: "Kunne ikke hente oppfølgingsplan",
    };
    const event = defineEvent<{}>(definition);

    definition.message = "Changed after registration";

    expect(event.message).toBe("Kunne ikke hente oppfølgingsplan");
    expect(Object.isFrozen(event)).toBe(true);
  });

  it.each([
    { name: "Not_a_stable_name" },
    { name: "a".repeat(81) },
    { name: "plan_fetch_failed\n" },
    { operation: "hent plan" },
    { operation: "" },
    { level: "debug" },
    { message: "  " },
  ])("rejects invalid definition metadata: %j", (invalid) => {
    const definition = {
      name: "plan_fetch_failed",
      level: "error",
      message: "Kunne ikke hente oppfølgingsplan",
      ...invalid,
    } as EventDefinition;

    expect(() => defineEvent<{}>(definition)).toThrow(TypeError);
  });

  it.each([
    "event_type",
    "operation",
    "level",
    "message",
    "msg",
    "err",
    "cause",
    "trace_id",
    "span_id",
    "trace_flags",
    "logger_name",
    "time",
    "timestamp",
    "pid",
    "hostname",
    "name",
  ])("rejects the reserved context field %s without exposing its value", (field) => {
    const lines: string[] = [];
    const log = createEventLogger(pino({ base: null }, { write: (line) => lines.push(line) }));
    const event = defineEvent<{ error_code: "NETWORK_ERROR" }>({
      name: "plan_fetch_failed",
      level: "error",
      message: "Kunne ikke hente oppfølgingsplan",
    });
    const context = {
      error_code: "NETWORK_ERROR",
      [field]: "private-canary-value",
    } as { error_code: "NETWORK_ERROR" };

    expect(() => log.event(event, context)).toThrow(
      `Context must not set reserved field: ${field}`,
    );
    expect(lines).toEqual([]);
  });

  it("binds an API rejection to WARN and the application's operation and reasons", () => {
    const lines: string[] = [];
    const log = createEventLogger(
      pino(
        { base: null, timestamp: false },
        {
          write: (line) => lines.push(line),
        },
      ),
    );
    const planAvvist = apiRequestRejected<{
      rejection_reason: "NOT_AUTHORIZED" | "PLAN_NOT_FOUND";
      upstream_status: 403 | 404;
    }>({
      operation: "hent_plan",
      message: "Oppfølgingsplan kunne ikke vises for denne tilgangen",
    });

    log.event(planAvvist, { rejection_reason: "NOT_AUTHORIZED", upstream_status: 403 });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      level: 40,
      msg: "Oppfølgingsplan kunne ikke vises for denne tilgangen",
      event_type: "api_request_rejected",
      operation: "hent_plan",
      rejection_reason: "NOT_AUTHORIZED",
      upstream_status: 403,
    });
  });

  it("preserves the original Error for the logger's native serializer", () => {
    const lines: string[] = [];
    const error = new Error("PDL lookup failed", {
      cause: new Error("Upstream transport closed"),
    });
    const serializedErrors: Error[] = [];
    const logger = pino(
      {
        base: null,
        timestamp: false,
        serializers: {
          err: (nativeError: Error) => {
            serializedErrors.push(nativeError);
            return pino.stdSerializers.err(nativeError);
          },
        },
      },
      { write: (line) => lines.push(line) },
    );
    const event = defineEvent<{ error_code: "UPSTREAM_ERROR" }>({
      name: "person_fetch_failed",
      level: "error",
      message: "Kunne ikke hente personopplysninger",
      operation: "hent_person",
    });

    createEventLogger(logger).event(event, { error_code: "UPSTREAM_ERROR" }, error);

    expect(serializedErrors).toEqual([error]);
    expect(serializedErrors[0]).toBe(error);
    expect(serializedErrors[0]?.cause).toBe(error.cause);
    const serialized = JSON.parse(lines[0]!);
    expect(serialized.msg).toBe(event.message);
    expect(serialized.err.message).toContain("PDL lookup failed");
    expect(serialized.err.message).toContain("Upstream transport closed");
    expect(serialized.err.stack).toContain(error.stack);
    expect(lines).toHaveLength(1);
  });

  it("preserves explicitly declared PDL error diagnostics without adding request data", () => {
    type PdlError = {
      message: string;
      extensions: { code: "not_found" | "server_error" };
      path: readonly string[];
    };
    const lines: string[] = [];
    const logger = pino(
      { base: null, timestamp: false },
      {
        write: (line) => lines.push(line),
      },
    );
    const event = defineEvent<{ pdl_errors: readonly PdlError[] }>({
      name: "person_fetch_failed",
      level: "error",
      message: "PDL returnerte feil ved personoppslag",
      operation: "hent_person",
    });
    const response = {
      errors: [
        {
          message: "Fant ikke person",
          extensions: { code: "not_found" as const },
          path: ["hentPerson"],
        },
      ],
      data: { ident: "private-canary-12345678901" },
    };

    createEventLogger(logger).event(event, { pdl_errors: response.errors });

    expect(JSON.parse(lines[0]!).pdl_errors).toEqual(response.errors);
    expect(lines.join("\n")).not.toContain("private-canary");
  });

  it("keeps the logger's receiver, child bindings and existing trace mixin", () => {
    const lines: string[] = [];
    const logger = pino(
      {
        base: null,
        timestamp: false,
        mixin: () => ({ trace_id: "0123456789abcdef0123456789abcdef" }),
      },
      { write: (line) => lines.push(line) },
    ).child({ app: "an-existing-app" });
    const event = defineEvent<{}>({
      name: "background_job_failed",
      level: "fatal",
      message: "Bakgrunnsjobben stoppet",
    });

    createEventLogger(logger).event(event, {});

    expect(JSON.parse(lines[0]!)).toEqual({
      app: "an-existing-app",
      trace_id: "0123456789abcdef0123456789abcdef",
      level: 60,
      msg: "Bakgrunnsjobben stoppet",
      event_type: "background_job_failed",
    });
  });
});
