import { describe, expect, it } from "vitest";
import { FRONTEND_ABI_VERSION, isFrontendCompatible } from "./version.js";

describe("FRONTEND_ABI_VERSION", () => {
  it("is 1.1 (plan 04 — the additive layout member bumped the minor)", () => {
    expect(FRONTEND_ABI_VERSION).toBe("1.1");
  });
});

describe("isFrontendCompatible — handshake accept/reject matrix (host 1.1.0)", () => {
  it("accepts the canonical authoring range ^1 (v1 plugins keep working — the plan-04 promise)", () => {
    expect(isFrontendCompatible("^1")).toBe(true);
    expect(isFrontendCompatible("^1.0")).toBe(true);
    expect(isFrontendCompatible("^1.0.0")).toBe(true);
  });

  it("accepts the bare major version (a major-compatibility claim: additive bumps never strand it)", () => {
    expect(isFrontendCompatible("1")).toBe(true);
    expect(isFrontendCompatible("~1")).toBe(true);
  });

  it("accepts plugins that REQUIRE the 1.1 ABI (^1.1 — the layout-declaring grammar)", () => {
    expect(isFrontendCompatible("^1.1")).toBe(true);
    expect(isFrontendCompatible("^1.1.0")).toBe(true);
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

  it("rejects a tilde/pin at an OLDER explicit minor (explicit pins reject additive bumps)", () => {
    expect(isFrontendCompatible("~0.9.0")).toBe(false);
    expect(isFrontendCompatible("~1.0.0")).toBe(false);
    expect(isFrontendCompatible("1.0.0")).toBe(false);
    expect(isFrontendCompatible("^1.0")).not.toBe(false); // caret 1.x tracks the major
  });

  it("rejects malformed ranges (fail closed, never throws)", () => {
    expect(isFrontendCompatible("")).toBe(false);
    expect(isFrontendCompatible("banana")).toBe(false);
    expect(isFrontendCompatible("^abc")).toBe(false);
    expect(isFrontendCompatible("1.0.0.0")).toBe(false);
  });

  it("the host version pins the answer (injectable for tests)", () => {
    // At a hypothetical 1.0.0 host, ^1.1 (needing the layout member) excludes;
    // at 1.1.0 it includes — the gate is real, not decorative.
    expect(isFrontendCompatible("^1.1", "1.0.0")).toBe(false);
    expect(isFrontendCompatible("^1.1", "1.1.0")).toBe(true);
    // "~1.0.0" pins minor 0: excludes a 1.1.0 host, includes a 1.0.x host.
    expect(isFrontendCompatible("~1.0.0", "1.1.0")).toBe(false);
    expect(isFrontendCompatible("~1.0.0", "1.0.0")).toBe(true);
  });
});
