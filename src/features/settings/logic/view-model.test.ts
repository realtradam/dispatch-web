import { describe, expect, it } from "vitest";
import { MAX_CHAT_LIMIT, MIN_CHAT_LIMIT } from "../../../core/chunks";
import { chatLimitChanged, parseChatLimit } from "./view-model";

describe("parseChatLimit", () => {
  it("parses a plain integer", () => {
    expect(parseChatLimit("256")).toEqual({ ok: true, value: 256 });
    expect(parseChatLimit("100")).toEqual({ ok: true, value: 100 });
  });

  it("trims surrounding whitespace", () => {
    expect(parseChatLimit("  50  ")).toEqual({ ok: true, value: 50 });
  });

  it("floors a decimal", () => {
    expect(parseChatLimit("100.9")).toEqual({ ok: true, value: 100 });
  });

  it("clamps below the floor to MIN_CHAT_LIMIT", () => {
    expect(parseChatLimit("0")).toEqual({ ok: true, value: MIN_CHAT_LIMIT });
    expect(parseChatLimit("-5")).toEqual({ ok: true, value: MIN_CHAT_LIMIT });
    expect(parseChatLimit("5")).toEqual({ ok: true, value: MIN_CHAT_LIMIT });
  });

  it("clamps above the ceiling to MAX_CHAT_LIMIT", () => {
    expect(parseChatLimit("99999999")).toEqual({ ok: true, value: MAX_CHAT_LIMIT });
  });

  it("rejects an empty string", () => {
    expect(parseChatLimit("")).toEqual({ ok: false, error: expect.any(String) });
    expect(parseChatLimit("   ")).toEqual({ ok: false, error: expect.any(String) });
  });

  it("rejects non-numeric input", () => {
    expect(parseChatLimit("abc")).toEqual({ ok: false, error: expect.any(String) });
    expect(parseChatLimit("twelve")).toEqual({ ok: false, error: expect.any(String) });
  });
});

describe("chatLimitChanged", () => {
  it("is false when the typed value normalizes to the current limit", () => {
    expect(chatLimitChanged("256", 256)).toBe(false);
  });

  it("is true when the typed value differs", () => {
    expect(chatLimitChanged("100", 256)).toBe(true);
    expect(chatLimitChanged("256", 100)).toBe(true);
  });

  it("is false for empty / invalid input (nothing submittable)", () => {
    expect(chatLimitChanged("", 256)).toBe(false);
    expect(chatLimitChanged("abc", 256)).toBe(false);
  });

  it("is false when the typed value clamps to the current limit", () => {
    // 5 clamps to MIN (10); current is already 10 → no change.
    expect(chatLimitChanged("5", MIN_CHAT_LIMIT)).toBe(false);
    // A huge value clamps to MAX; current is already MAX → no change.
    expect(chatLimitChanged("99999999", MAX_CHAT_LIMIT)).toBe(false);
  });
});
