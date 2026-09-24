import pino from "pino";
import { describe, expect, it } from "vitest";
import {
  causeChain, causeType, createEventLogger, defineEvent, exceptionType, failureFields, validUpstreamStatus,
} from "../src/index.js";

const contractType = /^([A-Za-z][A-Za-z0-9_.:$]{0,143})?(Error|Exception)$/;

describe("failure fields", () => {
  it("uses the first conforming error name in the prototype hierarchy", () => {
    class HttpClientErrorException extends Error {}
    class Forbidden extends HttpClientErrorException {}
    class OddlyNamedFailure extends Error {}
    const nested = new Forbidden("PRIVATE_nested");
    Object.defineProperty(Forbidden, "name", { value: "HttpClientErrorException$Forbidden" });
    expect(exceptionType(nested)).toBe("HttpClientErrorException");
    expect(exceptionType(new OddlyNamedFailure("PRIVATE_odd"))).toBe("Error");
    expect(exceptionType(new (class extends TypeError {})("PRIVATE_anonymous"))).toBe("TypeError");
    expect(exceptionType(Object.assign(new Error("PRIVATE_custom"), { name: "CustomError" }))).toBe("CustomError");
    expect(exceptionType({ name: "FakeError", message: "PRIVATE_fake" })).toBe("Error");
    expect(exceptionType(null)).toBe("Error");
    expect(exceptionType("PRIVATE_raw")).toBe("Error");
    expect(contractType.test(exceptionType(nested))).toBe(true);
  });

  it("bounds the cause chain and stops at cycles without exposing messages", () => {
    const first = new Error("PRIVATE_first");
    const second = new TypeError("PRIVATE_second");
    first.cause = second;
    second.cause = first;
    expect(causeChain(first)).toEqual([first, second]);
    expect(causeType(first)).toBe("TypeError");
    let chain: Error = new RangeError("PRIVATE_deep");
    for (let index = 0; index < 17; index++) chain = new Error("PRIVATE_wrapper", { cause: chain });
    expect(causeChain(chain)).toHaveLength(16);
    expect(causeChain(chain)).not.toContainEqual(expect.any(RangeError));
    expect(causeType(chain)).toBe("Error");
    expect(causeType({ cause: "PRIVATE_raw" })).toBe("Error");
  });

  it("stops at the collected error when a cause getter throws", () => {
    const error = new TypeError("PRIVATE_outer");
    Object.defineProperty(error, "cause", { get() { throw new Error("PRIVATE_unreadable"); } });

    expect(causeChain(error)).toEqual([error]);
    expect(causeType(error)).toBe("TypeError");
    expect(failureFields(error)).toEqual({ exception_type: "TypeError", cause_type: "TypeError" });
  });

  it("falls back when name or constructor inspection throws", () => {
    const badName = new TypeError("PRIVATE_name");
    Object.defineProperty(badName, "name", { get() { throw new Error("PRIVATE_unreadable"); } });
    class BadConstructorError extends Error {}
    Object.defineProperty(BadConstructorError.prototype, "constructor", {
      get() { throw new Error("PRIVATE_unreadable"); },
    });
    const badPrototype = new Proxy(new TypeError("PRIVATE_prototype"), {
      getPrototypeOf() { throw new Error("PRIVATE_unreadable"); },
    });

    for (const error of [badName, new BadConstructorError("PRIVATE_constructor"), badPrototype]) {
      expect(exceptionType(error)).toBe("Error");
      expect(failureFields(error).exception_type).toBe("Error");
    }
  });

  it("handles revoked proxies both as errors and as causes", () => {
    const { proxy, revoke } = Proxy.revocable(new TypeError("PRIVATE_revoked"), {});
    revoke();
    const outer = new RangeError("PRIVATE_outer", { cause: proxy });

    expect(causeChain(proxy)).toHaveLength(1);
    expect(causeChain(proxy)[0]).toBe(proxy);
    expect(exceptionType(proxy)).toBe("Error");
    expect(causeType(proxy)).toBe("Error");
    expect(failureFields(proxy)).toEqual({ exception_type: "Error", cause_type: "Error" });
    expect(causeChain(outer)).toHaveLength(2);
    expect(causeChain(outer)[0]).toBe(outer);
    expect(causeChain(outer)[1]).toBe(proxy);
    expect(causeType(outer)).toBe("Error");
    expect(failureFields(outer)).toEqual({ exception_type: "RangeError", cause_type: "Error" });
    expect(failureFields(undefined)).toEqual({ exception_type: "Error", cause_type: "Error" });
    expect(failureFields("PRIVATE_raw")).toEqual({ exception_type: "Error", cause_type: "Error" });
  });

  it("omits an unreadable upstream status without losing the type fields", () => {
    const options = { get upstreamStatus(): number { throw new Error("PRIVATE_unreadable"); } };
    expect(failureFields(new Error("PRIVATE_outer"), options)).toEqual({
      exception_type: "Error", cause_type: "Error",
    });
  });

  it.each([
    [99, undefined], [100, 100], [599, 599], [600, undefined], [null, undefined],
    ["503", undefined], [200.5, undefined], [Number.NaN, undefined],
  ])("validates HTTP status %s", (status, expected) => {
    expect(validUpstreamStatus(status)).toBe(expected);
  });

  it("spreads contract fields into a typed event without adding the Error or its message", () => {
    const lines: string[] = [];
    const logger = pino({ base: null, timestamp: false }, { write: (line) => lines.push(line) });
    const event = defineEvent<{
      error_code: "UPSTREAM_ERROR";
      exception_type: string;
      cause_type: string;
      upstream_status?: number;
    }>({ name: "plan_fetch_failed", level: "error", message: "Kunne ikke hente plan" });
    const cause = new TypeError("PRIVATE_inner");
    const failure = new Error("PRIVATE_outer", { cause });
    createEventLogger(logger).event(event, {
      error_code: "UPSTREAM_ERROR", ...failureFields(failure, { upstreamStatus: 503 }),
    });
    createEventLogger(logger).event(event, {
      error_code: "UPSTREAM_ERROR", ...failureFields(failure, { upstreamStatus: 99 }),
    });

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      event_type: "plan_fetch_failed", exception_type: "Error", cause_type: "TypeError", upstream_status: 503,
    });
    expect(JSON.parse(lines[1]!).upstream_status).toBeUndefined();
    expect(Object.keys(failureFields(failure))).toEqual(["exception_type", "cause_type"]);
    expect(failureFields(Object.assign(new Error("PRIVATE_code"), { code: "EPIPE" }))).not.toHaveProperty("sql_state");
    expect(contractType.test(causeType(failure))).toBe(true);
    expect(lines.join("\n")).not.toContain("PRIVATE_");
  });
});
