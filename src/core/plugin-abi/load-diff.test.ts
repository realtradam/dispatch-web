import type { PluginListResponse } from "@dispatch/transport-contract";
import { describe, expect, it } from "vitest";
import {
  decideFrontendLoads,
  frontendCandidates,
  type ImportedFrontendModule,
  usablePluginIds,
} from "./load-diff.js";
import { FRONTEND_ABI_VERSION } from "./version.js";

const httpBase = "http://localhost:24203";

function listWith(
  ...rows: readonly {
    readonly id: string;
    readonly apiVersion?: string;
    readonly bust?: string;
  }[]
): PluginListResponse {
  return {
    loaded: rows.map((r) => ({
      id: r.id,
      name: r.id,
      version: "1.0.0",
      tier: "standard" as const,
      trust: "local" as const,
      locked: false,
      dependsOn: [],
      ...(r.apiVersion === undefined
        ? {}
        : { frontend: { apiVersion: r.apiVersion, entry: "frontend.js", bust: r.bust ?? "1" } }),
    })),
    disabledWithReason: [],
    discovered: [],
    missing: [],
  };
}

describe("frontendCandidates", () => {
  it("derives candidates from loaded ∧ frontend-declaring ∧ workspace-enabled rows", () => {
    const candidates = frontendCandidates(
      listWith(
        { id: "a", apiVersion: "^1", bust: "111" },
        { id: "no-fe" },
        { id: "b", apiVersion: "^1", bust: "222" },
      ),
      { workspaceId: "team-a", usableIds: new Set(["a", "b", "no-fe"]), httpBase },
    );
    expect(candidates).toEqual([
      {
        id: "a",
        apiVersion: "^1",
        url: `${httpBase}/plugins/a/frontend?workspace=team-a&v=111`,
      },
      {
        id: "b",
        apiVersion: "^1",
        url: `${httpBase}/plugins/b/frontend?workspace=team-a&v=222`,
      },
    ]);
  });

  it("excludes plugins disabled in the active workspace", () => {
    const candidates = frontendCandidates(listWith({ id: "a", apiVersion: "^1" }), {
      workspaceId: "team-a",
      usableIds: new Set<string>(),
      httpBase,
    });
    expect(candidates).toEqual([]);
  });

  it("URL-encodes the workspace and bust", () => {
    const candidates = frontendCandidates(listWith({ id: "a", apiVersion: "^1", bust: "1 2" }), {
      workspaceId: "team a",
      usableIds: new Set(["a"]),
      httpBase,
    });
    expect(candidates[0]?.url).toBe(`${httpBase}/plugins/a/frontend?workspace=team%20a&v=1%202`);
  });
});

describe("usablePluginIds", () => {
  it("mirrors isPluginUsable: core usable unless disabled, others enabled-only", () => {
    const usable = usablePluginIds([
      { pluginId: "core-one", tier: "core", state: "undefined", loaded: true, locked: true },
      { pluginId: "core-off", tier: "core", state: "disabled", loaded: true, locked: true },
      { pluginId: "std-on", tier: "standard", state: "enabled", loaded: true, locked: false },
      { pluginId: "std-blank", tier: "standard", state: "undefined", loaded: true, locked: false },
      { pluginId: "prov-on", tier: "providers", state: "enabled", loaded: true, locked: false },
      { pluginId: "prov-off", tier: "providers", state: "disabled", loaded: true, locked: false },
    ]);
    expect([...usable].sort()).toEqual(["core-one", "prov-on", "std-on"]);
  });
});

describe("decideFrontendLoads — the load diff (boot / extensions-changed / workspace.set)", () => {
  const c = (id: string, bust = "1"): { id: string; url: string; apiVersion: string } => ({
    id,
    url: `${httpBase}/plugins/${id}/frontend?workspace=w&v=${bust}`,
    apiVersion: "^1",
  });

  it("boot: every desired candidate imports (nothing imported yet)", () => {
    const d = decideFrontendLoads([c("a"), c("b")], new Map());
    expect(d.toLoad.map((x) => x.id)).toEqual(["a", "b"]);
    expect(d.toUnload).toEqual([]);
    expect(d.incompatible).toEqual([]);
  });

  it("extensions-changed: a removed plugin unloads, a newcomer imports", () => {
    const imported = new Map<string, ImportedFrontendModule>([
      ["a", { url: c("a").url }],
      ["gone", { url: `${httpBase}/plugins/gone/frontend?workspace=w&v=1` }],
    ]);
    const d = decideFrontendLoads([c("a"), c("new")], imported);
    expect(d.toLoad.map((x) => x.id)).toEqual(["new"]);
    expect(d.toUnload).toEqual(["gone"]);
  });

  it("workspace.set: the enablement set change drives load AND unload", () => {
    // The candidate list already reflects the NEW workspace (composition
    // root re-derives per sync) — previously-imported ids absent from it unload.
    const imported = new Map<string, ImportedFrontendModule>([
      ["a", { url: c("a").url }],
      ["b", { url: c("b").url }],
    ]);
    const d = decideFrontendLoads([c("a")], imported);
    expect(d.toLoad).toEqual([]);
    expect(d.toUnload).toEqual(["b"]);
  });

  it("a stable desired set is a no-op (idempotent sync)", () => {
    const imported = new Map<string, ImportedFrontendModule>([
      ["a", { url: c("a").url }],
      ["b", { url: c("b").url }],
    ]);
    const d = decideFrontendLoads([c("a"), c("b")], imported);
    expect(d.toLoad).toEqual([]);
    expect(d.toUnload).toEqual([]);
  });

  it("a changed URL (backend reload → new bust) is unload + re-import", () => {
    const imported = new Map<string, ImportedFrontendModule>([["a", { url: c("a", "old").url }]]);
    const d = decideFrontendLoads([c("a", "new")], imported);
    expect(d.toLoad.map((x) => x.id)).toEqual(["a"]);
    expect(d.toUnload).toEqual(["a"]);
  });

  it("handshake failure → incompatible, never imported, still unloaded if it was", () => {
    const bad = { ...c("bad"), apiVersion: "^2" };
    const imported = new Map<string, ImportedFrontendModule>([["bad", { url: bad.url }]]);
    const d = decideFrontendLoads([bad], imported);
    expect(d.toLoad).toEqual([]);
    expect(d.incompatible).toEqual([{ id: "bad", apiVersion: "^2" }]);
    // The previously-imported instance must be swept (the manifest changed
    // under us — the UI must not keep running incompatible code).
    expect(d.toUnload).toEqual(["bad"]);
  });

  it("the handshake checks against FRONTEND_ABI_VERSION", () => {
    // A range that includes the host version passes — proving the version
    // constant feeds the check.
    expect(FRONTEND_ABI_VERSION).toBe("1");
    const d = decideFrontendLoads([c("ok")], new Map());
    expect(d.incompatible).toEqual([]);
  });
});
