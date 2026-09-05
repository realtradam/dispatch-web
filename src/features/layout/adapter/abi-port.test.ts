import { DEFAULT_LAYOUT, type LayoutTree } from "@dispatch/layout-contract";
import { describe, expect, it, vi } from "vitest";
import type { LayoutProviderState, LayoutStore } from "../store.svelte";
import { abiTree, createLayoutAbiPort } from "./abi-port";

/**
 * The ABI `layout` port tests (plan 04 §4.5) — the port is pure composition
 * over the layout store + the ops HTTP edge, so BOTH deps are fakes (the
 * outermost edges; nothing internal is mocked — asymmetric testing).
 */

function fakeStore(
  overrides: Partial<Pick<LayoutStore, "tree" | "providerState" | "activeWorkspaceId">> = {},
): LayoutStore {
  return {
    get tree(): LayoutTree {
      return DEFAULT_LAYOUT;
    },
    get providerState(): LayoutProviderState {
      return "present";
    },
    get activeWorkspaceId(): string {
      return "ws-a";
    },
    probe: vi.fn(async () => {}),
    onWorkspaceChanged: vi.fn(),
    onServerTree: vi.fn(),
    onTreeChange: vi.fn(),
    resetToDefault: vi.fn(async () => null),
    onExtensionsChanged: vi.fn(),
    ...overrides,
  } as LayoutStore;
}

describe("abiTree — the getTree decision (pure)", () => {
  it("a PRESENT provider exposes the tree", () => {
    expect(abiTree("present", DEFAULT_LAYOUT)).toBe(DEFAULT_LAYOUT);
  });

  it("no-provider mode (absent) exposes NULL — the local fallback is not shared state", () => {
    expect(abiTree("absent", DEFAULT_LAYOUT)).toBeNull();
  });

  it("an unknown (not-yet-probed) provider exposes NULL too", () => {
    expect(abiTree("unknown", DEFAULT_LAYOUT)).toBeNull();
  });
});

describe("createLayoutAbiPort — applyOps → the ops route", () => {
  it("posts to the ACTIVE workspace and feeds the returned tree back through the store", async () => {
    const ops = [{ type: "ensurePanel", panels: "side", view: "demo" }] as const;
    const edited: LayoutTree = { ...DEFAULT_LAYOUT };
    const store = fakeStore();
    const seen: string[] = [];
    const port = createLayoutAbiPort({
      store,
      postOps: async (workspaceId, o) => {
        seen.push(workspaceId);
        return { ok: true, tree: edited, applied: o.length };
      },
    });

    const result = await port.applyOps(ops);
    expect(seen).toEqual(["ws-a"]); // the ACTIVE workspace at CALL time
    expect(result).toEqual({ ok: true, tree: edited, applied: 1 });
    // The successful apply echoes the tree into the store (instant local
    // re-render; the WS broadcast echo is idempotent with this).
    expect(store.onServerTree).toHaveBeenCalledWith("ws-a", edited);
  });

  it("a failed batch (typed no-provider error) does NOT touch the store", async () => {
    const store = fakeStore({ providerState: "absent" });
    const port = createLayoutAbiPort({
      store,
      postOps: async () => ({ ok: false, error: "no layout provider active" }),
    });

    const result = await port.applyOps([{ type: "removeNode", target: "side" }]);
    expect(result).toEqual({ ok: false, error: "no layout provider active" });
    expect(store.onServerTree).not.toHaveBeenCalled();
  });

  it("getTree returns the active tree while the provider is present, null when absent", () => {
    const port = createLayoutAbiPort({
      store: fakeStore({ providerState: "present" }),
      postOps: async () => ({ ok: false, error: "unused" }),
    });
    expect(port.getTree()).toBe(DEFAULT_LAYOUT);

    const absent = createLayoutAbiPort({
      store: fakeStore({ providerState: "absent" }),
      postOps: async () => ({ ok: false, error: "no layout provider active" }),
    });
    expect(absent.getTree()).toBeNull();
  });
});
