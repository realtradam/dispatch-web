import { describe, expect, it, vi } from "vitest";
import { createWorkspaceHttp } from "./http";

/** Build a fake `fetch` returning a canned Response. */
function fakeFetch(responses: Array<{ status?: number; body?: unknown } | Error>): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const next = responses[i++];
    if (next === undefined) throw new Error("fakeFetch: no more canned responses");
    if (next instanceof Error) throw next;
    const status = next.status ?? 200;
    const body = next.body;
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return body;
      },
    } as Response;
  }) as unknown as typeof fetch;
}

const BASE = "http://x";

describe("createWorkspaceHttp", () => {
  it("list returns the workspaces", async () => {
    const fetchImpl = fakeFetch([
      {
        body: {
          workspaces: [
            {
              id: "a",
              title: "A",
              defaultCwd: null,
              createdAt: 1,
              lastActivityAt: 2,
              conversationCount: 3,
            },
          ],
        },
      },
    ]);
    const http = createWorkspaceHttp(BASE, fetchImpl);
    const list = await http.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("a");
    expect(list[0]?.conversationCount).toBe(3);
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/workspaces`);
  });

  it("list returns [] on a failed response (non-fatal)", async () => {
    const http = createWorkspaceHttp(BASE, fakeFetch([{ status: 500 }]));
    expect(await http.list()).toEqual([]);
  });

  it("list returns [] on a network error", async () => {
    const http = createWorkspaceHttp(BASE, fakeFetch([new Error("network")]));
    expect(await http.list()).toEqual([]);
  });

  it("ensure PUTs the id + returns the workspace", async () => {
    const ws = { id: "my-ws", title: "my-ws", defaultCwd: null, createdAt: 10, lastActivityAt: 10 };
    const fetchImpl = fakeFetch([{ body: ws }]);
    const http = createWorkspaceHttp(BASE, fetchImpl);
    const result = await http.ensure("my-ws");
    expect(result).toEqual({ ok: true, value: ws });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${BASE}/workspaces/my-ws`,
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("ensure surfaces the backend error on a 400 (invalid slug)", async () => {
    const http = createWorkspaceHttp(
      BASE,
      fakeFetch([{ status: 400, body: { error: "invalid slug" } }]),
    );
    const result = await http.ensure("UPPER");
    expect(result).toEqual({ ok: false, error: "invalid slug" });
  });

  it("get returns null on 404", async () => {
    const http = createWorkspaceHttp(BASE, fakeFetch([{ status: 404 }]));
    expect(await http.get("nope")).toBeNull();
  });

  it("get returns the workspace on 200", async () => {
    const ws = { id: "x", title: "X", defaultCwd: "/home", createdAt: 1, lastActivityAt: 2 };
    const http = createWorkspaceHttp(BASE, fakeFetch([{ body: ws }]));
    expect(await http.get("x")).toEqual(ws);
  });

  it("setTitle PUTs the title", async () => {
    const ws = { id: "a", title: "Renamed", defaultCwd: null, createdAt: 1, lastActivityAt: 2 };
    const fetchImpl = fakeFetch([{ body: ws }]);
    const http = createWorkspaceHttp(BASE, fetchImpl);
    const result = await http.setTitle("a", "Renamed");
    expect(result).toEqual({ ok: true, value: ws });
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).toBe(`${BASE}/workspaces/a/title`);
    expect(JSON.parse(call?.[1]?.body)).toEqual({ title: "Renamed" });
  });

  it("setDefaultCwd PUTs null to clear", async () => {
    const ws = { id: "a", title: "A", defaultCwd: null, createdAt: 1, lastActivityAt: 2 };
    const fetchImpl = fakeFetch([{ body: ws }]);
    const http = createWorkspaceHttp(BASE, fetchImpl);
    await http.setDefaultCwd("a", null);
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).toBe(`${BASE}/workspaces/a/default-cwd`);
    expect(JSON.parse(call?.[1]?.body)).toEqual({ defaultCwd: null });
  });

  it("delete returns closedCount", async () => {
    const fetchImpl = fakeFetch([{ body: { workspaceId: "a", closedCount: 4 } }]);
    const http = createWorkspaceHttp(BASE, fetchImpl);
    const result = await http.delete("a");
    expect(result).toEqual({ ok: true, value: { closedCount: 4 } });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${BASE}/workspaces/a`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("delete surfaces 409 for 'default'", async () => {
    const http = createWorkspaceHttp(
      BASE,
      fakeFetch([{ status: 409, body: { error: "cannot delete default" } }]),
    );
    const result = await http.delete("default");
    expect(result).toEqual({ ok: false, error: "cannot delete default" });
  });
});
