export type Level = "info" | "warn" | "error" | "fatal";

export { causeChain, causeType, exceptionType, failureFields, validUpstreamStatus } from "./failure-fields.js";

export type EventDefinition = Readonly<{
  name: string;
  level: Level;
  message: string;
  operation?: string;
}>;

const reservedFields = [
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
  "logging_context_invalid",
] as const;
type ReservedField = (typeof reservedFields)[number];
const reservedFieldSet: ReadonlySet<string> = new Set(reservedFields);

type Keys<T> = T extends unknown ? keyof T : never;
// Check each union branch so unrelated diagnostic fields cannot be combined.
type ExactContext<C, A> = C extends unknown
  ? A extends C
    ? Record<Exclude<Keys<A>, keyof C>, never>
    : never
  : never;
type AllowedContext<C> =
  string extends Keys<C>
    ? never
    : Exclude<Keys<C>, string> extends never
      ? Extract<Keys<C>, ReservedField> extends never
        ? unknown
        : never
      : never;

declare const contextType: unique symbol;

export interface Event<C extends object> extends EventDefinition {
  // Invariance prevents a log call from widening an event's declared context.
  readonly [contextType]: (context: C) => C;
}

export type NativeLogger = {
  [L in Level]: (fields: object, message: string) => void;
} & {
  isLevelEnabled?: (level: Level | "debug") => boolean;
};

export interface EventLogger {
  event<C extends object, const A extends NoInfer<C>>(
    event: Event<C>,
    context: A & NoInfer<ExactContext<C, A>>,
    cause?: Error,
  ): void;
}

export type DiagnosticValue = string | number | boolean | null | undefined;

const diagnosticReservedFields = [...reservedFields, "error_code", "rejection_reason"] as const;
type DiagnosticReservedField = (typeof diagnosticReservedFields)[number];
const diagnosticReservedFieldSet: ReadonlySet<string> = new Set(diagnosticReservedFields);
type AllowedDiagnosticFields<F> = AllowedContext<F> & {
  [K in keyof F]: K extends DiagnosticReservedField ? never : DiagnosticValue;
};

export type NativeApplicationLogger = NativeLogger & {
  debug: (fields: object, message: string) => void;
};

export interface ApplicationLogger extends EventLogger {
  info<const F extends object>(message: string, fields?: F & AllowedDiagnosticFields<F>): void;
  debug<const F extends object>(message: string, fields?: F & AllowedDiagnosticFields<F>): void;
}

const eventIdentity = /^[a-z][a-z0-9_.-]{0,79}$/;
const levels: ReadonlySet<string> = new Set(["info", "warn", "error", "fatal"]);

export function defineEvent<C extends object>(
  definition: EventDefinition & AllowedContext<C>,
): Event<C> {
  if (typeof definition.name !== "string" || !eventIdentity.test(definition.name)) {
    throw new TypeError("Event name must be a stable runtime event identifier");
  }
  if (!levels.has(definition.level)) {
    throw new TypeError("Event level must be info, warn, error or fatal");
  }
  if (typeof definition.message !== "string" || definition.message.trim() === "") {
    throw new TypeError("Event message must be a non-empty explanation");
  }
  if (
    definition.operation !== undefined &&
    (typeof definition.operation !== "string" || !eventIdentity.test(definition.operation))
  ) {
    throw new TypeError("Event operation must be a stable runtime operation identifier");
  }
  return Object.freeze({ ...definition }) as unknown as Event<C>;
}

export function apiRequestRejected<C extends { rejection_reason: string }>(
  definition: Readonly<{ operation: string; message: string }> & AllowedContext<C>,
): Event<C> {
  return defineEvent<C>({
    ...definition,
    name: "api_request_rejected",
    level: "warn",
  });
}

export function createEventLogger(logger: NativeLogger): EventLogger {
  return {
    event(event, context, cause) {
      if (logger.isLevelEnabled?.(event.level) === false) return;
      logger[event.level](
        {
          ...readContext(context, "event"),
          event_type: event.name,
          ...(event.operation === undefined ? {} : { operation: event.operation }),
          ...(cause === undefined ? {} : { err: cause }),
        },
        event.message,
      );
    },
  };
}

/** One application entry point, retaining the native logger's configuration. */
export function createLogger(logger: NativeApplicationLogger): ApplicationLogger {
  function diagnostic(level: "info" | "debug", message: string, fields?: object): void {
    if (logger.isLevelEnabled?.(level) === false) return;
    const context = readContext(fields, "diagnostic");
    if (typeof message !== "string") context.logging_context_invalid = true;
    logger[level](context, typeof message === "string" ? message : "Invalid diagnostic message");
  }

  return {
    ...createEventLogger(logger),
    info(message, fields) {
      diagnostic("info", message, fields);
    },
    debug(message, fields) {
      diagnostic("debug", message, fields);
    },
  };
}

/** Only metadata reads are guarded; native logging and reviewed nested event values remain native. */
function readContext(context: object | undefined, kind: "event" | "diagnostic"): Record<string, unknown> {
  if (kind === "diagnostic" && context === undefined) return {};
  const entries: [string, unknown][] = [];
  let invalid = false;
  let keys: string[];
  try {
    if (context === null || typeof context !== "object" || Array.isArray(context)) {
      return { logging_context_invalid: true };
    }
    if (kind === "diagnostic") {
      const prototype: unknown = Object.getPrototypeOf(context);
      if (prototype !== Object.prototype && prototype !== null) return { logging_context_invalid: true };
    }
    keys = Object.keys(context);
    invalid = Object.getOwnPropertySymbols(context).length > 0;
  } catch {
    return { logging_context_invalid: true };
  }

  const reserved = kind === "event" ? reservedFieldSet : diagnosticReservedFieldSet;
  for (const field of keys) {
    if (reserved.has(field)) {
      invalid = true;
      continue;
    }
    try {
      const value: unknown = (context as Record<string, unknown>)[field];
      if (kind === "diagnostic" && !isDiagnosticValue(value)) {
        invalid = true;
      } else if (kind === "event" || value !== undefined) {
        entries.push([field, value]);
      }
    } catch {
      invalid = true;
    }
  }
  if (invalid) entries.push(["logging_context_invalid", true]);
  return Object.fromEntries(entries);
}

function isDiagnosticValue(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
}
