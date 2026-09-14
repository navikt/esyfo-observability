import { isDeepStrictEqual } from "node:util";
import { assertContract } from "./contract.js";
import { parseLogs, type LogRecord } from "./parse.js";

export interface ExpectedLogEvent {
  event: Readonly<{
    name: string;
    level: "info" | "warn" | "error" | "fatal";
    message: string;
    operation?: string;
  }>;
  context?: Readonly<Record<string, unknown>>;
  /** The actual trace ID expected by this scenario, not a generated fallback. */
  traceId?: string;
  /** Required diagnostic text anywhere in the decoded record. */
  contains?: readonly string[];
  /** Synthetic privacy fixtures that must not occur anywhere in the decoded record. */
  excludes?: readonly string[];
}

const pinoLevels: Readonly<Record<number, string>> = { 30: "info", 40: "warn", 50: "error", 60: "fatal" };

function levelOf(record: LogRecord): unknown {
  const level = record.level;
  return typeof level === "number" ? pinoLevels[level] : typeof level === "string" ? level.toLowerCase() : level;
}

function checkEqual(actual: unknown, expected: unknown, field: string, index: number): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`Log record ${index + 1}: Unexpected or missing ${field}; values are not shown`);
  }
}

function containsText(value: unknown, text: string): boolean {
  if (typeof value === "string") return value.includes(text);
  if (Array.isArray(value)) return value.some((item) => containsText(item, text));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(([key, item]) => key.includes(text) || containsText(item, text));
  }
  return value !== undefined && String(value).includes(text);
}

/** Assert all records from a controlled scenario, including unmarked extra errors. */
export function assertLogEvents(output: string, expected: readonly ExpectedLogEvent[]): void {
  if (expected.length === 0) throw new Error("Provide at least one expected event; empty output is not contract evidence");
  const records = parseLogs(output);
  if (records.length !== expected.length) {
    throw new Error(`Expected ${expected.length} log record(s), found ${records.length}; no records are filtered out`);
  }
  for (const [index, expectation] of expected.entries()) {
    const record = records[index]!;
    if (Object.hasOwn(record, "logging_context_invalid")) {
      throw new Error(`Log record ${index + 1}: logging_context_invalid means context was omitted; fix the log call`);
    }
    assertContract(record, index);
    checkEqual(record.event_type, expectation.event.name, "event_type", index);
    checkEqual(levelOf(record), expectation.event.level, "level", index);
    checkEqual(record.message ?? record.msg, expectation.event.message, "message", index);
    if (expectation.event.operation !== undefined) {
      checkEqual(record.operation, expectation.event.operation, "operation", index);
    }
    for (const [field, value] of Object.entries(expectation.context ?? {})) {
      checkEqual(record[field], value, field, index);
    }
    if (expectation.traceId !== undefined) {
      checkEqual(record.trace_id, expectation.traceId, "trace_id", index);
    }
    for (const text of expectation.contains ?? []) {
      if (!text || !containsText(record, text)) throw new Error(`Log record ${index + 1}: Required diagnostic text is missing`);
    }
    for (const text of expectation.excludes ?? []) {
      if (!text) throw new Error("Privacy fixtures must not be empty");
      if (containsText(record, text)) throw new Error(`Log record ${index + 1}: Forbidden fixture value was emitted`);
    }
  }
}

export function assertLogEvent(output: string, expected: ExpectedLogEvent): void {
  assertLogEvents(output, [expected]);
}
