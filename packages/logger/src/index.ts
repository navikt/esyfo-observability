export type Level = "info" | "warn" | "error" | "fatal";

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
      for (const field of Object.keys(context)) {
        if (reservedFieldSet.has(field)) {
          throw new TypeError(`Context must not set reserved field: ${field}`);
        }
      }
      logger[event.level](
        {
          ...context,
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
  return {
    ...createEventLogger(logger),
    info(message, fields) {
      assertDiagnosticMessage(message);
      logger.info(diagnosticFields(fields), message);
    },
    debug(message, fields) {
      assertDiagnosticMessage(message);
      logger.debug(diagnosticFields(fields), message);
    },
  };
}

function assertDiagnosticMessage(message: string): void {
  if (typeof message !== "string" || message.trim() === "") {
    throw new TypeError("Diagnostic message must be a non-empty string");
  }
}

function diagnosticFields(fields: object = {}): object {
  const invalidFields = "Diagnostic fields must be a plain object containing only JSON primitives";
  if (fields === null || typeof fields !== "object") throw new TypeError(invalidFields);
  const prototype: unknown = Object.getPrototypeOf(fields);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(invalidFields);
  if (Object.getOwnPropertySymbols(fields).length > 0) throw new TypeError(invalidFields);

  const entries = Object.entries(fields);
  for (const [field, value] of entries) {
    if (diagnosticReservedFieldSet.has(field)) {
      throw new TypeError(`Diagnostic fields must not set reserved field: ${field}`);
    }
    if (value !== undefined && value !== null && typeof value !== "string" && typeof value !== "boolean" &&
      !(typeof value === "number" && Number.isFinite(value))) {
      throw new TypeError(invalidFields);
    }
  }
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}
