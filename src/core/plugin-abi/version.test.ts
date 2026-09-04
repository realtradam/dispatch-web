import { describe, expect, it } from "vitest";
import { FRONTEND_ABI_VERSION, isFrontendCompatible } from "./version.js";

describe("FRONTEND_ABI_VERSION", () => {
  it("is 1 (plan 03)", () => {
    expect(FRONTEND_ABI_VERSION).toBe("1");
  });
});

describe("isFrontendCompatible — handshake accept/reject matrix", () => {
  it("accepts the canonical authoring range ^1", () => {
    expect(isFrontendCompatible("^1")).toBe(true);
    expect(isFrontendCompatible("^1.0")).toBe(true);
    expect(isFrontendCompatible("^1.0.0")).toBe(true);
  });

  it("accepts the bare major version and exact matches", () => {
    expect(isFrontendCompatible("1")).toBe(true);
    expect(isFrontendCompatible("1.0.0")).toBe(true);
  });

  it("accepts wildcard and >= ranges", () => {
    expect(isFrontendCompatible("*")).toBe(true);
    expect(isFrontendCompatible(">=1.0.0")).toBe(true);
  });

  it("rejects a next-major caret range", () => {
    expect(isFrontendCompatible("^2")).toBe(false);
    expect(isFrontendCompatible("^2.0.0")).toBe(false);
  });

  it("rejects an older pinned range", () => {
    expect(isFrontendCompatible("0.9.0")).toBe(false);
    expect(isFrontendCompatible("^0.1.0")).toBe(false);
  });

  it("rejects a tilde range of an older minor", () => {
    expect(isFrontendCompatible("~0.9.0")).toBe(false);
    expect(isFrontendCompatible("~1.0.0")).toBe(true);
  });

  it("rejects malformed ranges (fail closed, never throws)", () => {
    expect(isFrontendCompatible("")).toBe(false);
    expect(isFrontendCompatible("banana")).toBe(false);
    expect(isFrontendCompatible("^abc")).toBe(false);
    expect(isFrontendCompatible("1.0.0.0")).toBe(false);
  });

  it("rejects a future patch-level host (the host version pins the answer)", () => {
    // The host version defaults to "1.0.0"; "~1.0.0" includes it.
    expect(isFrontendCompatible("~1.0.0", "1.0.0")).toBe(true);
    expect(isFrontendCompatible("~1.0.0", "1.1.0")).toBe(false);
  });
});
