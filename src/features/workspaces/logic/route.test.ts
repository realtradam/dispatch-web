import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_ID,
  isValidSlug,
  parsePath,
  WORKSPACE_SLUG_RE,
  workspacePath,
} from "./route";

describe("parsePath", () => {
  it("treats the root path as home", () => {
    expect(parsePath("/")).toEqual({ kind: "home" });
    expect(parsePath("")).toEqual({ kind: "home" });
  });

  it("trims surrounding slashes", () => {
    expect(parsePath("//")).toEqual({ kind: "home" });
    expect(parsePath("/my-ws/")).toEqual({ kind: "workspace", id: "my-ws" });
  });

  it("parses a single segment as a workspace id", () => {
    expect(parsePath("/default")).toEqual({ kind: "workspace", id: "default" });
    expect(parsePath("/my-workspace")).toEqual({ kind: "workspace", id: "my-workspace" });
    expect(parsePath("/ws1")).toEqual({ kind: "workspace", id: "ws1" });
  });

  it("takes only the first segment of a deeper path", () => {
    expect(parsePath("/foo/bar")).toEqual({ kind: "workspace", id: "foo" });
    expect(parsePath("/foo/bar/baz")).toEqual({ kind: "workspace", id: "foo" });
  });

  it("URL-decodes the segment", () => {
    expect(parsePath("/my%20ws")).toEqual({ kind: "workspace", id: "my ws" });
  });

  it("does not validate the slug — an invalid id is still a workspace route", () => {
    expect(parsePath("/UPPER")).toEqual({ kind: "workspace", id: "UPPER" });
    expect(parsePath("/has space")).toEqual({ kind: "workspace", id: "has space" });
  });
});

describe("isValidSlug", () => {
  it("accepts lowercase alphanumeric + internal hyphens", () => {
    expect(isValidSlug("default")).toBe(true);
    expect(isValidSlug("my-workspace")).toBe(true);
    expect(isValidSlug("a")).toBe(true);
    expect(isValidSlug("ws-1")).toBe(true);
  });

  it("accepts up to 40 chars", () => {
    expect(isValidSlug("a".repeat(40))).toBe(true);
  });

  it("rejects empty and too-long", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("a".repeat(41))).toBe(false);
  });

  it("rejects uppercase, spaces, and leading/trailing hyphens", () => {
    expect(isValidSlug("MyWS")).toBe(false);
    expect(isValidSlug("has space")).toBe(false);
    expect(isValidSlug("-leading")).toBe(false);
    expect(isValidSlug("trailing-")).toBe(false);
    expect(isValidSlug("double--hyphen")).toBe(true); // internal doubles are allowed by the regex
  });

  it("WORKSPACE_SLUG_RE matches the default id", () => {
    expect(WORKSPACE_SLUG_RE.test(DEFAULT_WORKSPACE_ID)).toBe(true);
  });
});

describe("workspacePath", () => {
  it("builds the URL path for a workspace id", () => {
    expect(workspacePath("default")).toBe("/default");
    expect(workspacePath("my-ws")).toBe("/my-ws");
  });
});
