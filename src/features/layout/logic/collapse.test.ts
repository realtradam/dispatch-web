import { describe, expect, it } from "vitest";
import {
  bootDefaultOpen,
  createCollapseStore,
  parsePersistedOpen,
  SIDEBAR_OPEN_KEY,
  WIDE_BREAKPOINT,
} from "./collapse";

function fakeStorage(): { storage: Storage; raw(key: string): string | null } {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: () => null,
    removeItem: (key) => map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
  return { storage, raw: (key) => map.get(key) ?? null };
}

describe("bootDefaultOpen", () => {
  it("defaults to open on wide screens (>= 1024px) and closed on narrow ones", () => {
    expect(bootDefaultOpen(WIDE_BREAKPOINT)).toBe(true);
    expect(bootDefaultOpen(1440)).toBe(true);
    expect(bootDefaultOpen(1023)).toBe(false);
    expect(bootDefaultOpen(0)).toBe(false);
  });

  it("defaults to open when the viewport is unknown (SSR/tests)", () => {
    expect(bootDefaultOpen(undefined)).toBe(true);
  });
});

describe("parsePersistedOpen", () => {
  it("accepts today's bare JSON boolean format", () => {
    expect(parsePersistedOpen("true")).toBe(true);
    expect(parsePersistedOpen("false")).toBe(false);
  });

  it("ignores null, malformed JSON, and non-boolean values", () => {
    expect(parsePersistedOpen(null)).toBeNull();
    expect(parsePersistedOpen("{")).toBeNull();
    expect(parsePersistedOpen('"true"')).toBeNull();
    expect(parsePersistedOpen("{}")).toBeNull();
  });
});

describe("createCollapseStore", () => {
  it("uses the viewport default when nothing is persisted", () => {
    const store = createCollapseStore({ viewportWidth: 1024 });
    expect(store.isOpen("side")).toBe(true);
    const narrow = createCollapseStore({ viewportWidth: 800 });
    expect(narrow.isOpen("side")).toBe(false);
  });

  it("restores the persisted boolean over the viewport default", () => {
    const { storage } = fakeStorage();
    storage.setItem(SIDEBAR_OPEN_KEY, "false");
    const store = createCollapseStore({ storage, viewportWidth: 1440 });
    expect(store.isOpen("side")).toBe(false);
  });

  it("persists toggles as today's bare JSON boolean (same key, same bytes)", () => {
    const { storage, raw } = fakeStorage();
    const store = createCollapseStore({ storage, viewportWidth: 1024 });
    store.toggle("side");
    expect(raw(SIDEBAR_OPEN_KEY)).toBe("false");
    store.toggle("side");
    expect(raw(SIDEBAR_OPEN_KEY)).toBe("true");
  });

  it("tracks per-node state reactively", () => {
    const store = createCollapseStore({ viewportWidth: 1024 });
    const seen: boolean[] = [];
    const unsubscribe = store.subscribe((state) =>
      seen.push(state.openByNode.side ?? state.defaultOpen),
    );
    try {
      store.setOpen("side", false);
      store.setOpen("side", true);
    } finally {
      unsubscribe();
    }
    expect(seen).toEqual([true, false, true]);
    expect(store.isOpen("side")).toBe(true);
  });

  it("an untracked node falls back to the default", () => {
    const store = createCollapseStore({ viewportWidth: 800 });
    expect(store.isOpen("other")).toBe(false);
  });

  it("survives storage failures (quota errors are swallowed)", () => {
    const broken: Storage = {
      get length() {
        return 0;
      },
      clear: () => undefined,
      getItem: () => null,
      key: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    const store = createCollapseStore({ storage: broken, viewportWidth: 1024 });
    expect(() => store.toggle("side")).not.toThrow();
    expect(store.isOpen("side")).toBe(false);
  });

  it("works without storage (session-only chrome state)", () => {
    const store = createCollapseStore({ viewportWidth: 1024 });
    store.toggle("side");
    expect(store.isOpen("side")).toBe(false);
  });
});
