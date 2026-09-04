import { DEFAULT_LAYOUT } from "@dispatch/layout-contract";
import { describe, expect, it } from "vitest";
import { createLayoutHttp } from "./http";

/**
 * Layout HTTP adapter tests — the OUTERMOST edge (fetch) is the only fake:
 * a scripted `fetchImpl` returning canned Responses. No internal mocks.
 */

const LAYOUT_URL = "http://backend.test/workspaces/ws-a/layout";

function fetchReturning(
  status: number,
  body: unknown,
  capture?: { url?: string; init?: RequestInit | undefined },
): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (capture !== undefined) {
      capture.url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      capture.init = init;
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

describe("createLayoutHttp — getTree", () => {
  it("GETs the well-known route and unwraps { tree }", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const http = createLayoutHttp(
      "http://backend.test",
      fetchReturning(200, { tree: DEFAULT_LAYOUT }, capture),
    );
    const result = await http.getTree("ws-a");
    expect(result).toEqual({ ok: true, tree: DEFAULT_LAYOUT });
    expect(capture.url).toBe(LAYOUT_URL);
    expect(capture.init?.method).toBeUndefined(); // GET is the default
  });

  it("maps a 404 to the no-provider signal (notFound: true)", async () => {
    const http = createLayoutHttp(
      "http://backend.test",
      fetchReturning(404, { error: "No layout provider is active" }),
    );
    const result = await http.getTree("ws-a");
    expect(result).toEqual({
      ok: false,
      notFound: true,
      error: "No layout provider is active",
    });
  });

  it("maps a 500 to a non-notFound failure carrying the body's error", async () => {
    const http = createLayoutHttp(
      "http://backend.test",
      fetchReturning(500, { error: "Layout storage failure" }),
    );
    const result = await http.getTree("ws-a");
    expect(result).toEqual({ ok: false, notFound: false, error: "Layout storage failure" });
  });

  it("a network failure degrades to notFound (the no-provider mode)", async () => {
    const http = createLayoutHttp("http://backend.test", async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await http.getTree("ws-a");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.notFound).toBe(true);
      expect(result.error).toContain("Failed to fetch");
    }
  });

  it("a malformed 200 (SPA-fallback JSON without a tree) degrades to notFound", async () => {
    const http = createLayoutHttp(
      "http://backend.test",
      fetchReturning(200, { chunks: [], latestSeq: 0 }),
    );
    const result = await http.getTree("ws-a");
    expect(result).toMatchObject({ ok: false, notFound: true });
  });
});

describe("createLayoutHttp — putTree", () => {
  it("PUTs { tree } as JSON and unwraps the echo", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const http = createLayoutHttp(
      "http://backend.test",
      fetchReturning(200, { tree: DEFAULT_LAYOUT }, capture),
    );
    const result = await http.putTree("ws-a", DEFAULT_LAYOUT);
    expect(result).toEqual({ ok: true, tree: DEFAULT_LAYOUT });
    expect(capture.init?.method).toBe("PUT");
    expect(capture.init?.body).toBe(JSON.stringify({ tree: DEFAULT_LAYOUT }));
  });

  it("maps a 400 { error } to a validation failure (not notFound)", async () => {
    const http = createLayoutHttp(
      "http://backend.test",
      fetchReturning(400, { error: "root: split has no children" }),
    );
    const result = await http.putTree("ws-a", DEFAULT_LAYOUT);
    expect(result).toEqual({
      ok: false,
      notFound: false,
      error: "root: split has no children",
    });
  });

  it("maps a 404 to the no-provider signal", async () => {
    const http = createLayoutHttp("http://backend.test", fetchReturning(404, {}));
    const result = await http.putTree("ws-a", DEFAULT_LAYOUT);
    expect(result).toMatchObject({ ok: false, notFound: true });
  });
});

describe("createLayoutHttp — deleteTree", () => {
  it("DELETEs and unwraps the fresh seed", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const http = createLayoutHttp(
      "http://backend.test",
      fetchReturning(200, { tree: DEFAULT_LAYOUT }, capture),
    );
    const result = await http.deleteTree("ws-a");
    expect(result).toEqual({ ok: true, tree: DEFAULT_LAYOUT });
    expect(capture.init?.method).toBe("DELETE");
  });

  it("maps a 404 to the no-provider signal", async () => {
    const http = createLayoutHttp("http://backend.test", fetchReturning(404, {}));
    const result = await http.deleteTree("ws-a");
    expect(result).toMatchObject({ ok: false, notFound: true });
  });
});
