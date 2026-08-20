import { describe, expect, it } from "vitest";
import { isUsableModel, isUsableName, nameError, normalizeName } from "./validate";

describe("normalizeName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeName("  Coding  ")).toBe("Coding");
  });

  it("collapses internal runs of whitespace to one space", () => {
    expect(normalizeName("  Research   Agent  ")).toBe("Research Agent");
  });

  it("collapses an all-whitespace name to empty", () => {
    expect(normalizeName("   ")).toBe("");
  });
});

describe("nameError", () => {
  it("returns null for a nonempty unique name", () => {
    expect(nameError("Coding", ["Research", "Fast"])).toBeNull();
  });

  it("flags an empty/normalized-empty name", () => {
    expect(nameError("", ["Research"])).toBe("Name is required.");
    expect(nameError("   ", ["Research"])).toBe("Name is required.");
  });

  it("flags a name duplicate case-insensitively", () => {
    expect(nameError("coding", ["Coding"])).toBe("A named agent with this name already exists.");
    expect(nameError("FAST", ["Fast"])).toBe("A named agent with this name already exists.");
  });

  it("ignores whitespace when comparing uniqueness", () => {
    expect(nameError("  coding  ", ["Coding "])).toBe(
      "A named agent with this name already exists.",
    );
  });
});

describe("isUsableName", () => {
  it("is true only for a unique nonempty name", () => {
    expect(isUsableName("Coding", ["Research"])).toBe(true);
    expect(isUsableName("coding", ["Coding"])).toBe(false);
    expect(isUsableName("", [])).toBe(false);
  });
});

describe("isUsableModel", () => {
  it("accepts a canonical provider/model pair", () => {
    expect(isUsableModel("opencode-1/claude-sonnet-4.5")).toBe(true);
  });

  it("rejects a slashless / provider-only value", () => {
    expect(isUsableModel("opencode-1")).toBe(false);
    expect(isUsableModel("/claude")).toBe(false);
    expect(isUsableModel("")).toBe(false);
  });
});
