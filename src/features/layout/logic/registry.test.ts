import type { Component } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import {
  getView,
  listPanelViews,
  listViews,
  registerView,
  unregisterView,
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
