import { describe, expect, it } from "vitest";
import { createHistoryAdapter, type HistoryWindow } from "./index";

/**
 * A minimal in-memory `HistoryWindow` fake for deterministic tests. `pathname`
 * is a closure variable reflected through the `location` getter; `back(url)`
 * simulates an external navigation (back/forward): it sets the path + fires the
 * popstate listeners.
 */
function fakeWindow(initial = "/"): HistoryWindow & { back(url: string): void } {
  let pathname = initial;
  const popstateListeners = new Set<() => void>();
  return {
    get location() {
      return {
        get pathname() {
          return pathname;
        },
      };
    },
    history: {
      pushState(_data, _unused, url) {
        if (typeof url === "string") pathname = url;
      },
      replaceState(_data, _unused, url) {
        if (typeof url === "string") pathname = url;
      },
    },
    addEventListener(type, listener) {
      if (type === "popstate") popstateListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "popstate") popstateListeners.delete(listener);
    },
    back(url: string) {
      pathname = url;
      for (const l of popstateListeners) l();
    },
  };
}

describe("createHistoryAdapter", () => {
  it("reads the current path", () => {
    const w = fakeWindow("/my-ws");
    const h = createHistoryAdapter({ window: w });
    expect(h.path).toBe("/my-ws");
  });

  it("navigate updates the path + notifies subscribers", () => {
    const w = fakeWindow("/");
    const h = createHistoryAdapter({ window: w });
    const seen: string[] = [];
    h.subscribe((p) => seen.push(p));
    h.navigate("/default");
    expect(h.path).toBe("/default");
    expect(seen).toEqual(["/default"]);
  });

  it("replace updates the path WITHOUT notifying", () => {
    const w = fakeWindow("/");
    const h = createHistoryAdapter({ window: w });
    const seen: string[] = [];
    h.subscribe((p) => seen.push(p));
    h.replace("/default");
    expect(h.path).toBe("/default");
    expect(seen).toEqual([]);
  });

  it("fires subscribers on popstate (back/forward)", () => {
    const w = fakeWindow("/");
    const h = createHistoryAdapter({ window: w });
    const seen: string[] = [];
    h.subscribe((p) => seen.push(p));
    w.back("/my-ws");
    expect(seen).toEqual(["/my-ws"]);
  });

  it("unsubscribe stops notifications (navigate + popstate)", () => {
    const w = fakeWindow("/");
    const h = createHistoryAdapter({ window: w });
    const seen: string[] = [];
    const unsub = h.subscribe((p) => seen.push(p));
    unsub();
    h.navigate("/default");
    w.back("/other");
    expect(seen).toEqual([]);
  });

  it("degrades to a no-op adapter when there is no location (SSR)", () => {
    const w = { location: undefined } as unknown as HistoryWindow;
    const h = createHistoryAdapter({ window: w });
    expect(h.path).toBe("/");
    const seen: string[] = [];
    h.subscribe((p) => seen.push(p));
    h.navigate("/default");
    expect(seen).toEqual([]);
  });
});
