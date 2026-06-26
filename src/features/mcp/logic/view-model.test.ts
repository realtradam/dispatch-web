import type { McpServerInfo } from "@dispatch/transport-contract";
import { describe, expect, it } from "vitest";
import { summarizeMcpServers, viewMcpServer, viewMcpServers } from "./view-model";

const server = (over: Partial<McpServerInfo> = {}): McpServerInfo => ({
  id: "freecad",
  state: "connected",
  toolCount: 12,
  ...over,
});

describe("viewMcpServer", () => {
  it("connected → success badge, not busy, no error, passes toolCount", () => {
    const v = viewMcpServer(server({ toolCount: 5 }));
    expect(v.badge).toBe("success");
    expect(v.statusLabel).toBe("Connected");
    expect(v.busy).toBe(false);
    expect(v.error).toBeNull();
    expect(v.toolCount).toBe(5);
    expect(v.configSource).toBeNull();
  });

  it("connecting → warning badge + busy (spinner)", () => {
    const v = viewMcpServer(server({ state: "connecting" }));
    expect(v.badge).toBe("warning");
    expect(v.statusLabel).toBe("Connecting…");
    expect(v.busy).toBe(true);
    expect(v.error).toBeNull();
  });

  it("disconnected → neutral badge, not busy", () => {
    const v = viewMcpServer(server({ state: "disconnected" }));
    expect(v.badge).toBe("neutral");
    expect(v.statusLabel).toBe("Disconnected");
    expect(v.busy).toBe(false);
    expect(v.error).toBeNull();
  });

  it("error → error badge + surfaces the reason (with a fallback)", () => {
    const withReason = viewMcpServer(server({ state: "error", error: "ENOENT: npx" }));
    expect(withReason.badge).toBe("error");
    expect(withReason.busy).toBe(false);
    expect(withReason.error).toBe("ENOENT: npx");

    const noReason = viewMcpServer(server({ state: "error" }));
    expect(noReason.error).toBe("Failed to connect");
  });

  it("passes through configSource when present", () => {
    const v = viewMcpServer(server({ configSource: ".dispatch/mcp.json" }));
    expect(v.configSource).toBe(".dispatch/mcp.json");
  });

  it("viewMcpServers maps a list preserving order", () => {
    const views = viewMcpServers([server({ id: "a" }), server({ id: "b" })]);
    expect(views.map((v) => v.id)).toEqual(["a", "b"]);
  });
});

describe("summarizeMcpServers", () => {
  it("empty list", () => {
    expect(summarizeMcpServers([])).toBe("No MCP servers");
  });

  it("counts connected / connecting / disconnected / errors", () => {
    expect(summarizeMcpServers([server({ state: "connected" })])).toBe("1 connected");
    expect(
      summarizeMcpServers([
        server({ id: "a", state: "connected" }),
        server({ id: "b", state: "error" }),
      ]),
    ).toBe("1 connected, 1 error");
    expect(
      summarizeMcpServers([
        server({ id: "a", state: "connected" }),
        server({ id: "b", state: "connecting" }),
        server({ id: "c", state: "disconnected" }),
        server({ id: "d", state: "error" }),
        server({ id: "e", state: "error" }),
      ]),
    ).toBe("1 connected, 1 connecting, 1 disconnected, 2 errors");
  });

  it("lists only non-zero buckets", () => {
    expect(summarizeMcpServers([server({ state: "disconnected" })])).toBe("1 disconnected");
    expect(summarizeMcpServers([server({ id: "a", state: "connecting" })])).toBe("1 connecting");
  });
});
