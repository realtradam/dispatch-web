import type { TurnProviderRetryEvent } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import { formatRetryDelay, viewProviderRetry } from "./retry-banner";

const retry = (
  attempt: number,
  delayMs: number,
  message = "HTTP 429: overloaded",
  code?: string,
): TurnProviderRetryEvent =>
  code !== undefined
    ? {
        type: "provider-retry",
        conversationId: "c1",
        turnId: "t1",
        attempt,
        delayMs,
        message,
        code,
      }
    : { type: "provider-retry", conversationId: "c1", turnId: "t1", attempt, delayMs, message };

describe("formatRetryDelay", () => {
  it("formats sub-minute delays as seconds", () => {
    expect(formatRetryDelay(5000)).toBe("5s");
    expect(formatRetryDelay(10000)).toBe("10s");
    expect(formatRetryDelay(30000)).toBe("30s");
  });

  it("formats minute+ delays as minutes", () => {
    expect(formatRetryDelay(60000)).toBe("1m");
    expect(formatRetryDelay(300000)).toBe("5m");
    expect(formatRetryDelay(1800000)).toBe("30m");
  });

  it("rounds to the nearest whole unit", () => {
    expect(formatRetryDelay(5500)).toBe("6s"); // 5.5s -> 6s
    expect(formatRetryDelay(90000)).toBe("2m"); // 1.5m -> 2m
  });
});

describe("viewProviderRetry", () => {
  it("labels the attempt 1-based (attempt 0 = Retry #1)", () => {
    expect(viewProviderRetry(retry(0, 5000)).attemptLabel).toBe("Retry #1");
    expect(viewProviderRetry(retry(1, 10000)).attemptLabel).toBe("Retry #2");
    expect(viewProviderRetry(retry(7, 1800000)).attemptLabel).toBe("Retry #8");
  });

  it("derives the delay label from delayMs", () => {
    expect(viewProviderRetry(retry(0, 5000)).delayLabel).toBe("5s");
    expect(viewProviderRetry(retry(4, 300000)).delayLabel).toBe("5m");
  });

  it("passes the endpoint error verbatim", () => {
    const msg = 'HTTP 429: {"error":{"type":"overloaded_error","message":"overloaded"}}';
    expect(viewProviderRetry(retry(0, 5000, msg)).message).toBe(msg);
  });

  it("surfaces the code when present, null when absent", () => {
    expect(viewProviderRetry(retry(0, 5000, "msg", "429")).code).toBe("429");
    expect(viewProviderRetry(retry(0, 5000, "msg")).code).toBeNull();
  });
});
