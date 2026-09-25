const maxCauseDepth = 16;
const exceptionTypePattern = /^([A-Za-z][A-Za-z0-9_$]{0,143})?(Error|Exception)$/;

/** Returns the error and up to 15 `.cause` values, stopping at cycles or unreadable causes. */
export function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && current !== undefined && chain.length < maxCauseDepth && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    if (typeof current !== "object" && typeof current !== "function") break;
    try {
      current = (current as { cause?: unknown }).cause;
    } catch {
      break;
    }
  }
  return chain;
}

/** Checks the Error's own `name`, then constructor names along its prototype chain; falls back to `Error`. */
export function exceptionType(error: unknown): string {
  try {
    if (!(error instanceof Error)) return "Error";
    if (Object.hasOwn(error, "name")) {
      const name: unknown = error.name;
      if (typeof name === "string" && exceptionTypePattern.test(name)) return name;
    }
    let prototype: object | null = Object.getPrototypeOf(error) as object | null;
    const seen = new Set<object>();
    while (prototype !== null && !seen.has(prototype)) {
      seen.add(prototype);
      const constructor: unknown = (prototype as { constructor?: unknown }).constructor;
      if (typeof constructor === "function") {
        const name: unknown = constructor.name;
        if (typeof name === "string" && exceptionTypePattern.test(name)) return name;
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
  } catch {
    return "Error";
  }
  return "Error";
}

/** Returns the category of the deepest reachable cause. */
export function causeType(error: unknown): string {
  const chain = causeChain(error);
  return exceptionType(chain[chain.length - 1]);
}

/** Returns only integer HTTP status values permitted by the runtime-error contract. */
export function validUpstreamStatus(status: unknown): number | undefined {
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
}

/**
 * Contract fields suitable for a typed event context; does not copy or scrub the Error.
 * Node always returns `exception_type` and `cause_type`, using `Error` for a non-Error or
 * undefined input. JVM `failureFields` omits these fields when its cause reader returns null.
 */
export function failureFields(error: unknown, options: { upstreamStatus?: unknown } = {}): Readonly<{
  exception_type: string;
  cause_type: string;
  upstream_status?: number;
}> {
  let status: number | undefined;
  try {
    status = validUpstreamStatus(options.upstreamStatus);
  } catch {
    status = undefined;
  }
  return {
    exception_type: exceptionType(error),
    cause_type: causeType(error),
    ...(status === undefined ? {} : { upstream_status: status }),
  };
}
