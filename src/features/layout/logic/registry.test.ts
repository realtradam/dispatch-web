import type { Component } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import {
  getView,
  listPanelViews,
  listViews,
  registerPluginView,
  registerView,
  unregisterView,
  unregisterViewsByPlugin,
  type ViewRegistration,
  viewRegistry,
} from "./registry";

const fakeComponent: Component = () => {
  throw new Error("fixture component should never be constructed");
};

function registration(overrides?: Partial<ViewRegistration>): ViewRegistration {
  return { id: "test-view", label: "Test View", component: fakeComponent, ...overrides };
}

const registeredIds = (): string[] => listViews().map((v) => v.id);

afterEach(() => {
  for (const id of registeredIds()) unregisterView(id);
});

describe("view registry", () => {
  it("registers a view and exposes it via getView/listViews", () => {
    registerView(registration());
    expect(getView("test-view")?.label).toBe("Test View");
    expect(registeredIds()).toContain("test-view");
  });

  it("throws loudly on a duplicate id", () => {
    registerView(registration());
    expect(() => registerView(registration({ label: "Other" }))).toThrow(/duplicate view id/);
  });

  it("normalizes panelEligible to true by default and respects false", () => {
    registerView(registration({ id: "a" }));
    registerView(registration({ id: "b", panelEligible: false }));
    expect(getView("a")?.panelEligible).toBe(true);
    expect(getView("b")?.panelEligible).toBe(false);
    expect(listPanelViews().map((v) => v.id)).toContain("a");
    expect(listPanelViews().map((v) => v.id)).not.toContain("b");
  });

  it("keeps pluginId when given", () => {
    registerView(registration({ id: "plugin-view", pluginId: "my-plugin" }));
    expect(getView("plugin-view")?.pluginId).toBe("my-plugin");
  });

  it("unregisterView removes the view (idempotent for unknown ids)", () => {
    registerView(registration({ id: "gone" }));
    unregisterView("gone");
    expect(getView("gone")).toBeUndefined();
    expect(() => unregisterView("never-registered")).not.toThrow();
  });

  it("is reactive: subscribers see registrations and unregistrations", () => {
    const seen: string[][] = [];
    const unsubscribe = viewRegistry.subscribe((views) => seen.push(views.map((v) => v.id)));
    try {
      registerView(registration({ id: "reactive-a" }));
      registerView(registration({ id: "reactive-b" }));
      unregisterView("reactive-a");
    } finally {
      unsubscribe();
    }
    expect(seen[0]).toEqual([]);
    expect(seen.at(-1)).toEqual(["reactive-b"]);
  });

  it("preserves registration order in listViews", () => {
    registerView(registration({ id: "z-first" }));
    registerView(registration({ id: "a-second" }));
    const ids = registeredIds();
    expect(ids.indexOf("z-first")).toBeLessThan(ids.indexOf("a-second"));
  });
});

// ── Plugin-view registration (plan 03) — forced attribution + the sweep ─────

describe("registerPluginView / unregisterViewsByPlugin (plan 03)", () => {
  it("forces the importing plugin's pluginId attribution", () => {
    const dispose = registerPluginView(
      { id: "abi-view", label: "ABI View", component: fakeComponent },
      "my-plugin",
    );
    expect(getView("abi-view")?.pluginId).toBe("my-plugin");
    dispose();
    expect(getView("abi-view")).toBeUndefined();
  });

  it("returns a working per-view disposer (the plugin deactivate contract)", () => {
    const dispose = registerPluginView(
      { id: "abi-view-2", label: "ABI View", component: fakeComponent },
      "my-plugin",
    );
    dispose();
    dispose(); // idempotent
    expect(getView("abi-view-2")).toBeUndefined();
  });

  it("the sweep removes exactly that plugin's views (registry attribution)", () => {
    registerPluginView({ id: "p1-a", label: "A", component: fakeComponent }, "plugin-1");
    registerPluginView({ id: "p1-b", label: "B", component: fakeComponent }, "plugin-1");
    registerPluginView({ id: "p2-a", label: "C", component: fakeComponent }, "plugin-2");
    registerView(registration({ id: "builtin" })); // no pluginId — never swept

    unregisterViewsByPlugin("plugin-1");
    expect(getView("p1-a")).toBeUndefined();
    expect(getView("p1-b")).toBeUndefined();
    expect(getView("p2-a")).not.toBeUndefined();
    expect(getView("builtin")).not.toBeUndefined();

    unregisterViewsByPlugin("plugin-2");
    expect(getView("p2-a")).toBeUndefined();
    expect(getView("builtin")).not.toBeUndefined();
  });

  it("the sweep is idempotent and a no-op for an unknown plugin", () => {
    unregisterViewsByPlugin("nobody");
    registerPluginView({ id: "p3-a", label: "A", component: fakeComponent }, "plugin-3");
    unregisterViewsByPlugin("plugin-3");
    expect(() => unregisterViewsByPlugin("plugin-3")).not.toThrow();
  });

  it("a duplicate id from a plugin throws LOUDLY (the driver marks it failed)", () => {
    registerView(registration({ id: "taken" }));
    expect(() =>
      registerPluginView({ id: "taken", label: "Taken", component: fakeComponent }, "my-plugin"),
    ).toThrow(/duplicate view id/);
  });

  it("sweep removals are visible to registry subscribers (reactive)", () => {
    const seen: string[][] = [];
    const unsubscribe = viewRegistry.subscribe((views) => {
      seen.push(views.map((v) => v.id));
    });
    registerPluginView({ id: "reactive", label: "R", component: fakeComponent }, "p");
    unregisterViewsByPlugin("p");
    unsubscribe();
    expect(seen.at(-1)).not.toContain("reactive");
  });
});
