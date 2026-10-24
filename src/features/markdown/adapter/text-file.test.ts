import { describe, expect, it, vi } from "vitest";
import type { TextFileState } from "../types";
import { createTextFileClient } from "./text-file";

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const context = { conversationId: "c", cwd: "/project", computerId: null };
const file = (text = "# Plan") => ({
  path: "/project/a.md",
  text,
  format: "markdown",
  bytes: new TextEncoder().encode(text).length,
  maxBytes: 262144,
});
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
describe("context-bound live-file client", () => {
  it("preflights once, sends both guards and encodes literal path once; dedups repeated references", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        response(String(url).endsWith("-context") ? context : file()),
      );
    const client = createTextFileClient("/api", "c", fetcher);
    const a: TextFileState[] = [],
      b: TextFileState[] = [];
    const offA = client.subscribe("notes/100%.md", (s) => a.push(s));
    const offB = client.subscribe("notes/100%.md", (s) => b.push(s));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const url = new URL(String(fetcher.mock.calls[1]?.[0]), "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      path: "notes/100%.md",
      expectedCwd: "/project",
      expectedComputerId: "",
    });
    expect(fetcher.mock.calls[1]?.[1]?.cache).toBe("no-store");
    expect(a.at(-1)?.kind).toBe("ready");
    expect(b.at(-1)?.kind).toBe("ready");
    offA();
    expect(fetcher.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
    offB();
    expect(fetcher.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    client.subscribe("notes/100%.md", () => {});
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(4);
    client.dispose();
  });
  it("never reads a file before context, handles remote inheritance explicitly", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ ...context, computerId: "remote" }));
    const client = createTextFileClient("", "c", fetcher);
    const states: TextFileState[] = [];
    client.subscribe("/same-local-path.md", (s) => states.push(s));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({
      kind: "error",
      message: expect.stringContaining("remote computers"),
    });
    client.dispose();
  });
  it.each([
    400, 404, 409, 413, 422,
  ])("reports HTTP %i then Retry refreshes authoritative context and live file", async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(context))
      .mockResolvedValueOnce(response({ error: `failure ${status}` }, status))
      .mockResolvedValueOnce(response(context))
      .mockResolvedValueOnce(response(file("changed")));
    const client = createTextFileClient("", "c", fetcher);
    const states: TextFileState[] = [];
    client.subscribe("a.md", (s) => states.push(s));
    await flush();
    expect(states.at(-1)).toEqual({ kind: "error", message: `failure ${status}` });
    client.refresh("a.md");
    await flush();
    expect(states.at(-1)).toMatchObject({ kind: "ready", file: { text: "changed" } });
    expect(fetcher).toHaveBeenCalledTimes(4);
    client.dispose();
  });
  it("guards late responses after refresh and disposal", async () => {
    let finish: (r: Response) => void = () => {};
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(context))
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            finish = r;
          }),
      )
      .mockResolvedValueOnce(response(context))
      .mockResolvedValueOnce(response(file("new")));
    const client = createTextFileClient("", "c", fetcher);
    const states: TextFileState[] = [];
    client.subscribe("a.md", (s) => states.push(s));
    await flush();
    client.refresh("a.md");
    await flush();
    finish(response(file("old")));
    await flush();
    expect(states.at(-1)).toMatchObject({ file: { text: "new" } });
    client.dispose();
    expect(fetcher.mock.calls[3]?.[1]?.signal?.aborted).toBe(true);
  });
  it("bounds active cache to32 files/8MiB source and concurrency to4, disposes queue", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).endsWith("-context") ? response(context) : new Promise(() => {}),
      );
    const client = createTextFileClient("", "c", fetcher);
    const overflow: TextFileState[] = [];
    for (let i = 0; i < 40; i++)
      client.subscribe(`${i}.md`, (s) => {
        if (i >= 32) overflow.push(s);
      });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(overflow).toHaveLength(8);
    expect(overflow[0]).toMatchObject({ kind: "error" });
    client.dispose();
    for (const call of fetcher.mock.calls) expect(call[1]?.signal?.aborted).toBe(true);
  });
  it("rejects oversized or malformed success data instead of truncating", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(context))
      .mockResolvedValueOnce(response(file("a".repeat(262145))));
    const client = createTextFileClient("", "c", fetcher);
    const states: TextFileState[] = [];
    client.subscribe("a.md", (s) => states.push(s));
    await flush();
    expect(states.at(-1)?.kind).toBe("error");
    client.dispose();
  });
});

it("invalidates every live document and reloads guards before publishing refreshed context", async () => {
  let generation = 0;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).endsWith("-context"))
      return response({ ...context, cwd: generation ? "/new" : "/project" });
    const params = new URL(String(url), "http://localhost").searchParams;
    return response({
      ...file(generation ? "new" : "old"),
      path: `${params.get("expectedCwd")}/a.md`,
    });
  });
  const client = createTextFileClient("", "c", fetcher);
  const a: TextFileState[] = [],
    b: TextFileState[] = [];
  client.subscribe("a.md", (state) => a.push(state));
  client.subscribe("b.md", (state) => b.push(state));
  await flush();
  generation++;
  client.refresh("a.md");
  expect(a.at(-1)?.kind).toBe("loading");
  expect(b.at(-1)?.kind).toBe("loading");
  await flush();
  expect(a.at(-1)).toMatchObject({ kind: "ready", file: { path: "/new/a.md", text: "new" } });
  expect(b.at(-1)).toMatchObject({ kind: "ready", file: { text: "new" } });
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("-context"))).toHaveLength(2);
  client.dispose();
});
