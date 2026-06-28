import type { WorkspaceEntry } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import { applyStarred, pageTitle, relativeTime, sortWorkspaces } from "./view-model";

describe("relativeTime", () => {
  const now = 1_000_000_000_000; // 2001-09-09

  it("is 'now' within a minute", () => {
    expect(relativeTime(now, now)).toBe("now");
    expect(relativeTime(now - 59_000, now)).toBe("now");
  });

  it("is minutes under an hour", () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m");
    expect(relativeTime(now - 59 * 60_000, now)).toBe("59m");
  });

  it("is hours under a day", () => {
    expect(relativeTime(now - 2 * 60 * 60_000, now)).toBe("2h");
  });

  it("is days under a week", () => {
    expect(relativeTime(now - 3 * 24 * 60 * 60_000, now)).toBe("3d");
  });

  it("is a short date beyond a week", () => {
    // 7+ days ago: just check it is a MM/DD string.
    const s = relativeTime(now - 10 * 24 * 60 * 60_000, now);
    expect(s).toMatch(/^\d{2}\/\d{2}$/);
  });
});

describe("pageTitle", () => {
  // Minimal valid WorkspaceEntry (the irrelevant metadata is zeroed).
  const ws = (id: string, title: string): WorkspaceEntry => ({
    id,
    title,
    defaultCwd: null,
    defaultComputerId: null,
    starred: false,
    createdAt: 0,
    lastActivityAt: 0,
    conversationCount: 0,
  });

  it("is 'Dispatch' for the home route", () => {
    expect(pageTitle({ kind: "home" }, [])).toBe("Dispatch");
    expect(pageTitle({ kind: "home" }, [ws("default", "Default")])).toBe("Dispatch");
  });

  it("is 'Dispatch: {title}' for a workspace with a display title", () => {
    const list = [ws("default", "Default"), ws("my-ws", "My Workspace")];
    expect(pageTitle({ kind: "workspace", id: "my-ws" }, list)).toBe("Dispatch: My Workspace");
  });

  it("falls back to the slug (id) until the list has loaded the workspace", () => {
    expect(pageTitle({ kind: "workspace", id: "pending" }, [])).toBe("Dispatch: pending");
  });

  it("uses the id as the title when it was never customized (defaults to id)", () => {
    const list = [ws("default", "default")];
    expect(pageTitle({ kind: "workspace", id: "default" }, list)).toBe("Dispatch: default");
  });

  it("matches by id, not title", () => {
    const list = [ws("a", "shared-title"), ws("b", "shared-title")];
    expect(pageTitle({ kind: "workspace", id: "b" }, list)).toBe("Dispatch: shared-title");
  });
});

describe("sortWorkspaces", () => {
  const entry = (id: string, starred: boolean, lastActivityAt: number): WorkspaceEntry => ({
    id,
    title: id,
    defaultCwd: null,
    defaultComputerId: null,
    starred,
    createdAt: 0,
    lastActivityAt,
    conversationCount: 0,
  });

  it("puts starred workspaces before unstarred", () => {
    const list = [entry("plain", false, 9_000), entry("star", true, 1_000)];
    expect(sortWorkspaces(list).map((w) => w.id)).toEqual(["star", "plain"]);
  });

  it("within the starred group, sorts by lastActivityAt desc", () => {
    const list = [
      entry("old-star", true, 1_000),
      entry("new-star", true, 5_000),
      entry("plain", false, 9_000),
    ];
    expect(sortWorkspaces(list).map((w) => w.id)).toEqual(["new-star", "old-star", "plain"]);
  });

  it("within the unstarred group, sorts by lastActivityAt desc", () => {
    const list = [
      entry("star", true, 1_000),
      entry("old-plain", false, 1_000),
      entry("new-plain", false, 5_000),
    ];
    expect(sortWorkspaces(list).map((w) => w.id)).toEqual(["star", "new-plain", "old-plain"]);
  });

  it("returns a new array (does not mutate the input)", () => {
    const list = [entry("plain", false, 9_000), entry("star", true, 1_000)];
    const sorted = sortWorkspaces(list);
    expect(sorted).not.toBe(list);
    // Input order is preserved (not mutated).
    expect(list.map((w) => w.id)).toEqual(["plain", "star"]);
    expect(sorted.map((w) => w.id)).toEqual(["star", "plain"]);
  });

  it("handles an empty list", () => {
    expect(sortWorkspaces([])).toEqual([]);
  });

  it("is stable for equal lastActivityAt within a group", () => {
    const list = [
      entry("first", false, 5_000),
      entry("second", false, 5_000),
      entry("third", false, 5_000),
    ];
    expect(sortWorkspaces(list).map((w) => w.id)).toEqual(["first", "second", "third"]);
  });
});

describe("applyStarred", () => {
  const entry = (id: string, starred: boolean): WorkspaceEntry => ({
    id,
    title: id,
    defaultCwd: null,
    defaultComputerId: null,
    starred,
    createdAt: 0,
    lastActivityAt: 0,
    conversationCount: 0,
  });

  it("sets the named workspace's starred flag", () => {
    const list = [entry("a", false), entry("b", false)];
    const next = applyStarred(list, "b", true);
    expect(next.map((w) => [w.id, w.starred])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  it("returns a new array (does not mutate the input)", () => {
    const list = [entry("a", false)];
    const next = applyStarred(list, "a", true);
    expect(next).not.toBe(list);
    expect(list[0]?.starred).toBe(false);
    expect(next[0]?.starred).toBe(true);
  });

  it("leaves other entries referentially unchanged (only the target is replaced)", () => {
    const a = entry("a", false);
    const b = entry("b", false);
    const next = applyStarred([a, b], "b", true);
    expect(next[0]).toBe(a);
    expect(next[1]).not.toBe(b);
  });

  it("leaves the list unchanged when the id is absent (not yet loaded)", () => {
    const list = [entry("a", false)];
    const next = applyStarred(list, "missing", true);
    expect(next.map((w) => [w.id, w.starred])).toEqual([["a", false]]);
  });

  it("can revert by re-applying the previous value", () => {
    const list = [entry("a", false)];
    const optimistic = applyStarred(list, "a", true);
    expect(optimistic[0]?.starred).toBe(true);
    const reverted = applyStarred(optimistic, "a", false);
    expect(reverted[0]?.starred).toBe(false);
  });
});
