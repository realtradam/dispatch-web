import type { TileGeometryMode, TileLayoutData } from "@dispatch/tile-layout-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TileLayoutHttp, TileLayoutHttpResult } from "./adapter/tile-layout-http";
import { geometryFor, type TileLayoutEntry } from "./logic/tile-layout";
import { createTileLayoutStore } from "./tile-layout-store.svelte";

const WIDE = geometryFor(1920, 1080);

function tile(id: string, order: number, colSpan = 1, rowSpan = 1): TileLayoutEntry {
  return { id, order, colSpan, rowSpan };
}

function doc(...tiles: TileLayoutEntry[]): TileLayoutData {
  return { version: 2, tiles };
}

/** A controllable fake HTTP edge: per-mode documents + a call log (no mocks of our modules). */
function fakeHttp(
  initial: Partial<Record<TileGeometryMode, TileLayoutData>> = {},
): TileLayoutHttp & {
  docs: Map<TileGeometryMode, TileLayoutData>;
  puts: Array<{ mode: TileGeometryMode; layout: TileLayoutData }>;
  failNext: { get: string | null; put: string | null };
} {
  const docs = new Map<TileGeometryMode, TileLayoutData>(
    Object.entries(initial) as Array<[TileGeometryMode, TileLayoutData]>,
  );
  const puts: Array<{ mode: TileGeometryMode; layout: TileLayoutData }> = [];
  const failNext = { get: null as string | null, put: null as string | null };
  const ok = (layout: TileLayoutData): TileLayoutHttpResult => ({ ok: true, layout });
  return {
    docs,
    puts,
    failNext,
    async getLayout(mode) {
      if (failNext.get !== null) {
        const error = failNext.get;
        failNext.get = null;
        return { ok: false, notFound: false, error };
      }
      return ok(docs.get(mode) ?? doc());
    },
    async putLayout(mode, layout) {
      if (failNext.put !== null) {
        const error = failNext.put;
        failNext.put = null;
        return { ok: false, notFound: false, error };
      }
      puts.push({ mode, layout });
      docs.set(mode, layout);
      return ok(layout);
    },
    async deleteLayout(mode) {
      docs.set(mode, doc());
      return ok(docs.get(mode) as TileLayoutData);
    },
  };
}

/** Flush the boot probe + debounced timers (microtasks first, then the clock). */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(300);
  await Promise.resolve();
}

async function flushOnly(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
}

describe("createTileLayoutStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the boot probe applies the server document for the initial mode", async () => {
    const http = fakeHttp({ wide: doc(tile("a", 0, 2, 2)) });
    const store = createTileLayoutStore({ http });
    await flushOnly();
    expect(store.entries).toEqual([tile("a", 0, 2, 2)]);
    expect(store.providerState).toBe("present");
    expect(store.mode).toBe("wide");
  });

  it("sanitizes the server document defensively (a junk shape degrades to empty)", async () => {
    const http = fakeHttp();
    http.docs.set("wide", { junk: true } as unknown as TileLayoutData);
    const store = createTileLayoutStore({ http });
    await flushOnly();
    expect(store.entries).toEqual([]);
  });

  it("a probe failure degrades to absent (ephemeral edits, no PUT)", async () => {
    const warn = vi.fn();
    const http = fakeHttp();
    http.failNext.get = "network down";
    const store = createTileLayoutStore({ http, warn });
    await flushOnly();
    expect(store.providerState).toBe("absent");

    store.resize("a", 3, 3); // applied locally…
    store.sync(["a"]);
    await settle();
    expect(store.entries.map((t) => t.id)).toEqual(["a"]);
    expect(http.puts).toHaveLength(0); // …but never written
    expect(warn).toHaveBeenCalledTimes(1); // logged ONCE, no error UI
  });

  it("setMode switches orientation: reset + fresh probe (documents are independent)", async () => {
    const http = fakeHttp({
      wide: doc(tile("desktop", 0)),
      tall: doc(tile("mobile", 0)),
    });
    const store = createTileLayoutStore({ http });
    await flushOnly();
    expect(store.entries.map((t) => t.id)).toEqual(["desktop"]);

    store.setMode("tall");
    await flushOnly();
    expect(store.mode).toBe("tall");
    expect(store.entries.map((t) => t.id)).toEqual(["mobile"]);

    store.setMode("tall"); // same-mode call: a no-op
    store.setMode("wide");
    await flushOnly();
    expect(store.entries.map((t) => t.id)).toEqual(["desktop"]);
  });

  it("an in-flight probe for a stale mode never lands", async () => {
    const http = fakeHttp({ wide: doc(tile("desktop", 0)) });
    // A holder object defeats TS's closure narrowing (a bare `let` read after
    // the callback-assigned write narrows to `null` and the call sites to
    // `never`).
    const gate: { release: ((value: TileLayoutHttpResult) => void) | null } = { release: null };
    const slow = http.getLayout.bind(http);
    http.getLayout = (mode) =>
      mode === "tall"
        ? new Promise<TileLayoutHttpResult>((resolve) => {
            gate.release = resolve;
          })
        : slow(mode);
    const store = createTileLayoutStore({ http });
    await flushOnly();

    store.setMode("tall"); // probe in flight…
    store.setMode("wide"); // …superseded before it resolves
    gate.release?.({ ok: true, layout: doc(tile("mobile", 0)) });
    await flushOnly();

    // The stale tall response must NOT overwrite the active wide document.
    expect(store.mode).toBe("wide");
    expect(store.entries.map((t) => t.id)).toEqual(["desktop"]);
  });

  it("a WS push applies for the ACTIVE mode and is IGNORED for the other", async () => {
    const http = fakeHttp({ wide: doc(tile("a", 0)) });
    const store = createTileLayoutStore({ http });
    await flushOnly();

    store.onServerTileLayout("tall", doc(tile("mobile-push", 0)));
    expect(store.entries.map((t) => t.id)).toEqual(["a"]); // filtered

    store.onServerTileLayout("wide", doc(tile("push", 0)));
    expect(store.entries.map((t) => t.id)).toEqual(["push"]); // applied
  });

  it("edits apply locally IMMEDIATELY, then PUT the whole document (debounced)", async () => {
    const http = fakeHttp({ wide: doc(tile("a", 0)) });
    const store = createTileLayoutStore({ http, debounceMs: 300 });
    await flushOnly();

    store.resize("a", 4, 2);
    expect(store.entries).toEqual([tile("a", 0, 4, 2)]); // local, no wait
    expect(http.puts).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(300);
    expect(http.puts).toEqual([{ mode: "wide", layout: doc(tile("a", 0, 4, 2)) }]);
  });

  it("edits ride the ACTIVE mode's document (the tall PUT names tall)", async () => {
    const http = fakeHttp({ tall: doc(tile("m", 0)) });
    const store = createTileLayoutStore({ http });
    store.setMode("tall");
    await flushOnly();

    store.resize("m", 2, 2);
    await settle();
    expect(http.puts).toEqual([{ mode: "tall", layout: doc(tile("m", 0, 2, 2)) }]);
  });

  it("a failed PUT on a present backend rolls back to the last server document", async () => {
    const warn = vi.fn();
    const http = fakeHttp({ wide: doc(tile("a", 0)) });
    const store = createTileLayoutStore({ http, warn, debounceMs: 300 });
    await flushOnly();

    http.failNext.put = "500 gone";
    store.resize("a", 4, 2);
    await settle();

    expect(store.entries).toEqual([tile("a", 0)]); // rolled back
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("sync merges the live workspace list (gated while the first probe is in flight)", async () => {
    const http = fakeHttp({ wide: doc(tile("a", 0)) });
    const store = createTileLayoutStore({ http });
    // NO flush — the boot probe is still in flight (providerState unknown).

    store.sync(["a", "b"]); // would merge into the empty placeholder…
    expect(store.providerState).toBe("unknown");
    expect(store.entries).toEqual([]); // …so it is a no-op until the probe settles

    await flushOnly();
    store.sync(["a", "b"]);
    expect(store.entries.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("sync appends unknown ids, drops deleted ones, and persists once", async () => {
    const http = fakeHttp({ wide: doc(tile("a", 0), tile("gone", 1)) });
    const store = createTileLayoutStore({ http });
    await flushOnly();

    store.sync(["a", "b"]);
    await settle();

    expect(store.entries.map((t) => t.id)).toEqual(["a", "b"]);
    // The max order counts KEPT entries (the dropped one doesn't reserve a slot).
    expect(http.puts.at(-1)?.layout).toEqual(
      doc(tile("a", 0), { id: "b", colSpan: 1, rowSpan: 1, order: 1 }),
    );
  });

  it("sync is a no-op (no write) when the merge changes nothing", async () => {
    const http = fakeHttp({ wide: doc(tile("a", 0)) });
    const store = createTileLayoutStore({ http });
    await flushOnly();

    store.sync(["a"]);
    store.sync(["a"]);
    await settle();

    expect(http.puts).toHaveLength(0);
  });

  it("placeAtCell commits the displacement and pins EVERY tile (persisted to the server)", async () => {
    const http = fakeHttp({ wide: doc(tile("a", 0), tile("b", 1)) });
    const store = createTileLayoutStore({ http });
    await flushOnly();

    // a@(1,1), b@(1,2) → drag a to (2,1): a pins there, b keeps its cell.
    store.placeAtCell("a", { col: 2, row: 1 }, WIDE);
    await settle();

    const entries = store.entries;
    expect(entries.find((t) => t.id === "a")).toMatchObject({ col: 2, row: 1 });
    expect(entries.find((t) => t.id === "b")).toMatchObject({ col: 1, row: 2 });
    expect(http.puts.at(-1)?.layout.version).toBe(2);
  });

  it("placeAtCell with an unknown id is a no-op (no write)", async () => {
    const http = fakeHttp({ wide: doc(tile("a", 0)) });
    const store = createTileLayoutStore({ http });
    await flushOnly();

    store.placeAtCell("nope", { col: 1, row: 1 }, WIDE);
    await settle();

    expect(http.puts).toHaveLength(0);
    expect(store.entries).toEqual([tile("a", 0)]);
  });

  it("placeFirstEmpty PINS the new id at the first empty slot (idempotent on re-call)", async () => {
    const http = fakeHttp({ wide: doc(tile("a", 0, 1, 2), tile("b", 1)) });
    const store = createTileLayoutStore({ http });
    await flushOnly();

    store.placeFirstEmpty("new", WIDE);
    await settle();

    // a packs rows 1-2, b row 3 → the first empty slot is (col1,row4) → pinned.
    expect(store.entries.find((t) => t.id === "new")).toMatchObject({ col: 1, row: 4 });
    expect(http.puts.at(-1)?.layout.tiles.map((t) => t.id)).toEqual(["a", "b", "new"]);

    store.placeFirstEmpty("new", WIDE); // the create flow's re-call must be stable
    expect(store.entries.find((t) => t.id === "new")).toMatchObject({ col: 1, row: 4 });
  });

  it("sortByRecentActivity re-applies recent-activity order and CLEARs pins", async () => {
    const http = fakeHttp({
      wide: doc({ ...tile("a", 0), col: 1, row: 1 }, { ...tile("b", 1), col: 2, row: 3 }),
    });
    const store = createTileLayoutStore({ http });
    await flushOnly();

    store.sortByRecentActivity(
      new Map([
        ["a", 10],
        ["b", 99],
      ]),
    );

    expect(store.entries.map((t) => t.id)).toEqual(["b", "a"]);
    expect(store.entries.every((t) => t.col === undefined && t.row === undefined)).toBe(true);
  });

  it("a WS push supersedes a queued edit (the server's copy wins)", async () => {
    const http = fakeHttp({ wide: doc(tile("a", 0)) });
    const store = createTileLayoutStore({ http, debounceMs: 300 });
    await flushOnly();

    store.resize("a", 4, 2); // edit queued…
    store.onServerTileLayout("wide", doc(tile("server-wins", 0))); // …server lands first
    await settle();

    expect(store.entries.map((t) => t.id)).toEqual(["server-wins"]);
    expect(http.puts).toHaveLength(0); // the queued edit was dropped, not PUT
  });

  it("probe() re-reads the active orientation (the reconnect catch-up)", async () => {
    const http = fakeHttp({ wide: doc() });
    const store = createTileLayoutStore({ http });
    await flushOnly();

    http.docs.set("wide", doc(tile("fresh", 0)));
    await store.probe();
    expect(store.entries.map((t) => t.id)).toEqual(["fresh"]);
  });
});
