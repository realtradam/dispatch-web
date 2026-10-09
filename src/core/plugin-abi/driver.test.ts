import { describe, expect, it, vi } from "vitest";
import { createFrontendDriver, type FrontendDriverDeps } from "./driver.js";
import type { FrontendCandidate } from "./load-diff.js";

/**
 * Asymmetric testing: the ONLY fake is the OUTERMOST edge (the dynamic
 * import + the host-API builder — injected effects). The driver's internals,
 * the load diff, and the registry-facing sweep contract are real.
 */

const c = (id: string, bust = "1"): FrontendCandidate => ({
  id,
  url: `http://x/plugins/${id}/frontend?workspace=w&v=${bust}`,
  apiVersion: "^1",
});

interface Harness {
  readonly deps: FrontendDriverDeps & {
    // The race test swaps the import edge before the driver exists — the
    // driver reads the dep object per call, so the mutation is the swap.
    importModule: (url: string) => Promise<unknown>;
  };
  readonly imports: string[];
  readonly sweeps: string[];
  /** The modules the fake import() returns, keyed by the next id. */
  readonly modules: Map<string, unknown>;
  readonly logs: string[];
}

function harness(): Harness {
  const imports: string[] = [];
  const sweeps: string[] = [];
  const logs: string[] = [];
  const modules = new Map<string, unknown>();
  const deps: FrontendDriverDeps = {
    importModule: async (url) => {
      imports.push(url);
      const id = new URL(url).pathname.split("/")[2] ?? "";
      const mod = modules.get(id);
      if (mod === undefined) throw new Error(`404: ${url}`);
      return mod;
    },
    buildHostApi: (pluginId) => ({
      abiVersion: "1.1",
      registerView: () => () => {},
      surfaces: {
        subscribe: () => {},
        unsubscribe: () => {},
        invoke: () => {},
        getSpec: () => null,
      },
      logger: { info: () => {}, warn: () => {} },
      layout: {
        applyOps: async () => ({ ok: false, error: "no layout provider active" }),
        getTree: () => null,
      },
      ...(pluginId === undefined ? {} : {}),
    }),
    unregisterViewsByPlugin: (pluginId) => sweeps.push(pluginId),
    logger: {
      info: (msg) => logs.push(msg),
      warn: (msg) => logs.push(msg),
    },
  };
  return { deps, imports, sweeps, modules, logs };
}

describe("createFrontendDriver — the load lifecycle", () => {
  it("boot: imports newcomers and calls activate with the plugin's own host API", async () => {
    const h = harness();
    const activate = vi.fn();
    h.modules.set("a", { default: { activate } });
    const driver = createFrontendDriver(h.deps);
    await driver.sync([c("a")]);
    expect(h.imports).toEqual([c("a").url]);
    expect(activate).toHaveBeenCalledOnce();
    expect(driver.states().get("a")).toEqual({ kind: "loaded" });
  });

  it("extensions-changed: a vanished plugin runs its deactivate + the registry sweep", async () => {
    const h = harness();
    const deactivate = vi.fn();
    h.modules.set("a", { default: { activate: () => deactivate } });
    const driver = createFrontendDriver(h.deps);
    await driver.sync([c("a")]);
    await driver.sync([]); // the plugin is gone from the desired set
    expect(deactivate).toHaveBeenCalledOnce();
    expect(h.sweeps).toEqual(["a"]);
    expect(driver.states().has("a")).toBe(false);
  });

  it("unload disposes EXACTLY that plugin (the sweep is per-pluginId)", async () => {
    const h = harness();
    h.modules.set("a", { default: { activate: () => () => {} } });
    h.modules.set("b", { default: { activate: () => () => {} } });
    const driver = createFrontendDriver(h.deps);
    await driver.sync([c("a"), c("b")]);
    await driver.sync([c("b")]); // only `a` vanishes
    expect(h.sweeps).toEqual(["a"]);
  });

  it("workspace.set / re-enable: the SAME url re-activates the cached module", async () => {
    const h = harness();
    const activate = vi.fn();
    h.modules.set("a", { default: { activate } });
    const driver = createFrontendDriver(h.deps);
    await driver.sync([c("a")]);
    await driver.sync([]); // disable → unload (disposer + sweep)
    await driver.sync([c("a")]); // re-enable → activate re-runs
    expect(h.imports).toEqual([c("a").url, c("a").url]); // re-fetched URL
    expect(activate).toHaveBeenCalledTimes(2);
    expect(h.sweeps).toEqual(["a"]);
  });

  it("a changed URL (backend reload) unloads then re-imports fresh code", async () => {
    const h = harness();
    const activate = vi.fn(() => () => {});
    h.modules.set("a", { default: { activate } });
    const driver = createFrontendDriver(h.deps);
    await driver.sync([c("a", "old")]);
    await driver.sync([c("a", "new")]);
    expect(h.sweeps).toEqual(["a"]);
    expect(h.imports).toEqual([c("a", "old").url, c("a", "new").url]);
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it("a throwing activate is LOUD: failed state, no crash, others still load", async () => {
    const h = harness();
    h.modules.set("bad", {
      default: {
        activate: () => {
          throw new Error("boom");
        },
      },
    });
    h.modules.set("good", { default: { activate: () => () => {} } });
    const driver = createFrontendDriver(h.deps);
    await driver.sync([c("bad"), c("good")]);
    expect(driver.states().get("bad")).toEqual({ kind: "failed", error: "boom" });
    expect(driver.states().get("good")).toEqual({ kind: "loaded" });
    // The failed plugin owns nothing — the sweep never ran for it.
    expect(h.sweeps).toEqual([]);
  });

  it("a broken module (404 / missing activate) is a failed state, not a crash", async () => {
    const h = harness();
    h.modules.set("no-activate", { default: {} });
    const driver = createFrontendDriver(h.deps);
    await driver.sync([c("ghost"), c("no-activate")]);
    expect(driver.states().get("ghost")?.kind).toBe("failed");
    expect(driver.states().get("no-activate")?.kind).toBe("failed");
    expect(h.logs.some((l) => l.includes("activation failed"))).toBe(true);
  });

  it("a throwing deactivate still gets the registry sweep (views never linger)", async () => {
    const h = harness();
    h.modules.set("a", {
      default: {
        activate: () => () => {
          throw new Error("disposer boom");
        },
      },
    });
    const driver = createFrontendDriver(h.deps);
    await driver.sync([c("a")]);
    await driver.sync([]);
    expect(h.sweeps).toEqual(["a"]);
  });

  it("handshake-incompatible candidates are never imported (reported for the UI)", async () => {
    const h = harness();
    const driver = createFrontendDriver(h.deps);
    await driver.sync([{ ...c("bad"), apiVersion: "^2" }]);
    expect(h.imports).toEqual([]);
    expect(driver.states().get("bad")).toEqual({ kind: "incompatible", apiVersion: "^2" });
  });

  it("overlapping syncs serialize (boot + extensions-changed race)", async () => {
    const h = harness();
    let releaseImport: (() => void) | undefined;
    h.modules.set("a", {
      default: {
        activate: () => {
          return () => {};
        },
      },
    });
    const blockingImport = async (url: string) => {
      h.imports.push(url);
      await new Promise<void>((resolve) => {
        releaseImport = resolve;
      });
      return h.modules.get("a");
    };
    // Swap the import edge BEFORE the driver exists (the driver reads the
    // dep object per call — the swap is the injection point for the race).
    h.deps.importModule = blockingImport;
    const driver = createFrontendDriver(h.deps);
    const first = driver.sync([c("a")]);
    const second = driver.sync([]); // queued behind the first
    // While the first sync is blocked on import, the second must not have
    // started (no unload of `a` mid-import).
    await new Promise((r) => setTimeout(r, 10));
    releaseImport?.();
    await Promise.all([first, second]);
    // The second pass sees `a` already imported (the queued sync ran after)
    // and unloads it — exactly one sweep, no interleaving.
    expect(h.sweeps).toEqual(["a"]);
  });
});
