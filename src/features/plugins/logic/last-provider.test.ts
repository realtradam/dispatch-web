import { describe, expect, it } from "vitest";
import { isLastProvider, unloadBlockReason } from "./last-provider";
import { node } from "./test-fixtures";

describe("isLastProvider", () => {
  it("is true for a loaded provider when it is the only one", () => {
    const nodes = [node({ id: "opencode", tier: "providers" })];
    expect(isLastProvider("opencode", nodes)).toBe(true);
  });

  it("is false for a loaded provider when another provider is loaded", () => {
    const nodes = [
      node({ id: "opencode", tier: "providers" }),
      node({ id: "kimi", tier: "providers" }),
    ];
    expect(isLastProvider("opencode", nodes)).toBe(false);
  });

  it("is false for a non-provider target (even when alone)", () => {
    const nodes = [node({ id: "solo", tier: "standard" })];
    expect(isLastProvider("solo", nodes)).toBe(false);
  });

  it("is false for an UNLOADED provider", () => {
    const nodes = [node({ id: "opencode", tier: "providers", loaded: false })];
    expect(isLastProvider("opencode", nodes)).toBe(false);
  });

  it("is false for an unknown id", () => {
    expect(isLastProvider("ghost", [])).toBe(false);
  });

  it("is false for a core-only list (no providers at all)", () => {
    const nodes = [node({ id: "kernel", tier: "core", locked: true })];
    expect(isLastProvider("kernel", nodes)).toBe(false);
  });
});

describe("unloadBlockReason", () => {
  it("explains the core lock", () => {
    const nodes = [node({ id: "kernel", tier: "core", locked: true })];
    const reason = unloadBlockReason("kernel", nodes);
    expect(reason).toContain("Core plugins cannot be unloaded");
  });

  it("explains the last-provider lock", () => {
    const nodes = [node({ id: "opencode", tier: "providers" })];
    const reason = unloadBlockReason("opencode", nodes);
    expect(reason).toContain("last provider");
  });

  it("is null for an interactive row", () => {
    const nodes = [
      node({ id: "opencode", tier: "providers" }),
      node({ id: "kimi", tier: "providers" }),
      node({ id: "app" }),
    ];
    expect(unloadBlockReason("app", nodes)).toBeNull();
    expect(unloadBlockReason("opencode", nodes)).toBeNull();
  });

  it("prefers the core lock when both would apply", () => {
    const nodes = [node({ id: "kernel", tier: "core", locked: true })];
    expect(unloadBlockReason("kernel", nodes)).toContain("Core");
  });

  it("is null for an unknown id", () => {
    expect(unloadBlockReason("ghost", [])).toBeNull();
  });
});
