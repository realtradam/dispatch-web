import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginsHttp } from "./http";

/** A stub fetch that records requests and replies from a handler. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return await handler(url, init);
  });
  return impl as unknown as typeof fetch;
}

const okJson = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPluginsHttp — manager routes (plan 05)", () => {
  it("GET /plugins returns the parsed list (null on failure)", async () => {
    const fetch1 = stubFetch(() =>
      okJson({ loaded: [], disabledWithReason: [], discovered: [], missing: [] }),
    );
    const http = createPluginsHttp("http://x", fetch1);
    await expect(http.list()).resolves.toEqual({
      loaded: [],
      disabledWithReason: [],
      discovered: [],
      missing: [],
    });

    const fetch2 = stubFetch(() => ({ ok: false, status: 503 }) as unknown as Response);
    await expect(createPluginsHttp("http://x", fetch2).list()).resolves.toBeNull();
  });

  it("POST /plugins/scan posts to the scan route", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const fetch1 = stubFetch((url, init) => {
      seenUrl = url;
      seenInit = init;
      return okJson({ root: "/plugins", newPlugins: [], invalid: [], incompatible: [] });
    });
    const http = createPluginsHttp("http://x", fetch1);
    const result = await http.scan();
    expect(result.ok).toBe(true);
    expect(seenUrl).toBe("http://x/plugins/scan");
    expect(seenInit?.method).toBe("POST");
  });

  it("POST /plugins/:id/unload sends the force flag in the body", async () => {
    let seenBody: string | undefined;
    const fetch1 = stubFetch((_url, init) => {
      seenBody = init?.body as string;
      return okJson({ ok: true, action: "unload", id: "mcp" });
    });
    const http = createPluginsHttp("http://x", fetch1);
    await http.unload("mcp", true);
    expect(JSON.parse(seenBody ?? "{}")).toEqual({ force: true });
  });

  it("maps a blocked mutation (409) to ok:false with reason + dependents", async () => {
    const fetch1 = stubFetch(
      () =>
        ({
          ok: false,
          status: 409,
          json: async () => ({
            ok: false,
            action: "unload",
            id: "heartbeat",
            reason: "cascade-needs-force",
            message: "blocked",
            dependents: ["transport-http"],
          }),
        }) as unknown as Response,
    );
    const http = createPluginsHttp("http://x", fetch1);
    const result = await http.unload("heartbeat", false);
    expect(result).toEqual({
      ok: false,
      error: "blocked",
      reason: "cascade-needs-force",
      dependents: ["transport-http"],
    });
  });

  it("load and reload hit their routes with the encoded id", async () => {
    const urls: string[] = [];
    const fetch1 = stubFetch((url) => {
      urls.push(url);
      return okJson({ ok: true, action: "load", id: "a/b" });
    });
    const http = createPluginsHttp("http://x", fetch1);
    await http.load("a/b");
    await http.reload("a/b");
    expect(urls).toEqual(["http://x/plugins/a%2Fb/load", "http://x/plugins/a%2Fb/reload"]);
  });
});

describe("createPluginsHttp — workspace routes (plan 06 §6.6)", () => {
  it("GET /workspaces/:id/plugins returns the parsed response (null on failure)", async () => {
    const fetch1 = stubFetch(() =>
      okJson({ workspaceId: "ws", plugins: [], enabledProviderCount: 2 }),
    );
    const http = createPluginsHttp("http://x", fetch1);
    await expect(http.workspacePlugins("ws")).resolves.toEqual({
      workspaceId: "ws",
      plugins: [],
      enabledProviderCount: 2,
    });

    const fetch2 = stubFetch(() => ({ ok: false, status: 503 }) as unknown as Response);
    await expect(createPluginsHttp("http://x", fetch2).workspacePlugins("ws")).resolves.toBeNull();
  });

  it("PUT /workspaces/:id/plugins/:pluginId sends the state body", async () => {
    let seenUrl = "";
    let seenBody: string | undefined;
    const fetch1 = stubFetch((url, init) => {
      seenUrl = url;
      seenBody = init?.body as string;
      return okJson({ workspaceId: "ws", pluginId: "mcp", state: "enabled" });
    });
    const http = createPluginsHttp("http://x", fetch1);
    const result = await http.setWorkspaceState("ws", "mcp", "enabled");
    expect(result.ok).toBe(true);
    expect(seenUrl).toBe("http://x/workspaces/ws/plugins/mcp");
    expect(JSON.parse(seenBody ?? "{}")).toEqual({ state: "enabled" });
  });

  it("maps a 409 refusal (core-locked) to ok:false with the reason", async () => {
    const fetch1 = stubFetch(
      () =>
        ({
          ok: false,
          status: 409,
          json: async () => ({
            workspaceId: "ws",
            pluginId: "kernel",
            reason: "core-locked",
            message: "core is locked",
          }),
        }) as unknown as Response,
    );
    const http = createPluginsHttp("http://x", fetch1);
    const result = await http.setWorkspaceState("ws", "kernel", "disabled");
    expect(result).toEqual({ ok: false, error: "core is locked", reason: "core-locked" });
  });

  it("GET providers-status returns the parsed response", async () => {
    let seenUrl = "";
    const fetch1 = stubFetch((url) => {
      seenUrl = url;
      return okJson({ workspaceId: "ws", enabledProviderCount: 0 });
    });
    const http = createPluginsHttp("http://x", fetch1);
    await expect(http.providersStatus("ws")).resolves.toEqual({
      workspaceId: "ws",
      enabledProviderCount: 0,
    });
    expect(seenUrl).toBe("http://x/workspaces/ws/plugins/providers-status");
  });

  it("network throws degrade reads to null and mutations to ok:false", async () => {
    const boom = vi.fn(async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    const http = createPluginsHttp("http://x", boom);
    await expect(http.list()).resolves.toBeNull();
    await expect(http.providersStatus("ws")).resolves.toBeNull();
    await expect(http.setWorkspaceState("ws", "mcp", "enabled")).resolves.toMatchObject({
      ok: false,
    });
  });
});
