import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin, PreviewServer, ViteDevServer } from "vite";
import { describe, expect, it, vi } from "vitest";
import { applyViteNetworkPolicy, devNetworkGuard } from "./vite-network-guard";

const policy = {
  allowedHosts: new Set(["localhost", "127.0.0.1", "::1", "node.ts.net", "100.64.0.10"]),
  allowedAddresses: new Set(["127.0.0.1", "::1", "100.64.0.10"]),
};

function install(mode: "dev" | "preview") {
  let middleware: Connect.NextHandleFunction | undefined;
  const http = new EventEmitter();
  const upgrade = vi.fn();
  http.on("upgrade", upgrade);
  const server = {
    middlewares: {
      use: (handler: Connect.NextHandleFunction) => {
        middleware = handler;
      },
    },
    httpServer: http,
  };
  const plugin = devNetworkGuard(policy);
  const hook = mode === "dev" ? plugin.configureServer : plugin.configurePreviewServer;
  if (typeof hook !== "function") throw new Error(`Missing ${mode} guard hook`);
  // Hooks only need the injected middleware stack and HTTP event emitter.
  hook.call({} as never, server as unknown as ViteDevServer & PreviewServer);
  if (!middleware) throw new Error(`Missing ${mode} middleware`);
  return { middleware, http, upgrade };
}

function request(localAddress: string | undefined, host?: string, origin?: string) {
  return { socket: { localAddress }, headers: { host, origin } } as IncomingMessage;
}

const cases = [
  ["loopback", "127.0.0.1", "localhost", undefined, 200],
  ["IPv6 loopback", "::1", "[::1]:34204", undefined, 200],
  ["mapped address / canonical Host", "::ffff:127.0.0.1", "LOCALHOST.:34204", undefined, 200],
  ["tailnet", "100.64.0.10", "node.ts.net", "https://node.ts.net:34204", 200],
  ["unselected interface with trusted Host", "172.17.0.1", "localhost", undefined, 403],
  ["missing interface", undefined, "localhost", undefined, 403],
  ["arbitrary IP Host", "127.0.0.1", "127.0.0.2", undefined, 421],
  ["rebinding Host", "127.0.0.1", "evil.example", undefined, 421],
  ["missing Host", "127.0.0.1", undefined, undefined, 421],
  ["disallowed Origin", "127.0.0.1", "localhost", "https://evil.example", 403],
  ["opaque Origin", "127.0.0.1", "localhost", "null", 403],
  ["Host before Origin", "127.0.0.1", "evil.example", "null", 421],
] as const;

describe.each(["dev", "preview"] as const)("%s HTTP guard", (mode) => {
  it.each(cases)("%s", (_label, local, host, origin, status) => {
    const { middleware } = install(mode);
    const req = request(local, host, origin);
    const writeHead = vi.fn();
    const end = vi.fn();
    const next = vi.fn();
    middleware(req, { writeHead, end } as unknown as ServerResponse, next);
    if (status === 200) {
      expect(next).toHaveBeenCalledExactlyOnceWith();
      expect(writeHead).not.toHaveBeenCalled();
      if (host === "LOCALHOST.:34204") expect(req.headers.host).toBe("localhost:34204");
    } else {
      expect(writeHead).toHaveBeenCalledWith(status, { "Content-Type": "text/plain" });
      expect(end).toHaveBeenCalledOnce();
      expect(next).not.toHaveBeenCalled(); // In particular, cannot reach CORS/static serving.
    }
  });
});

describe("dev upgrades remain protected", () => {
  it.each(cases)("%s", (_label, local, host, origin, status) => {
    const { http, upgrade } = install("dev");
    const end = vi.fn();
    http.emit("upgrade", request(local, host, origin), { end }, Buffer.alloc(0));
    if (status === 200) {
      expect(upgrade).toHaveBeenCalledOnce();
      expect(end).not.toHaveBeenCalled();
    } else {
      expect(upgrade).not.toHaveBeenCalled();
      expect(end).toHaveBeenCalledWith(expect.stringContaining(`HTTP/1.1 ${status}`));
    }
  });
});

it("sets explicit allowlists and guarded CORS for preview as well as dev", () => {
  const config = applyViteNetworkPolicy(
    {
      server: { host: true, port: 34204 },
      preview: { host: true, port: 34204, cors: true, allowedHosts: true },
    },
    policy,
  );
  for (const serving of [config.server, config.preview]) {
    expect(serving?.allowedHosts).toEqual([...policy.allowedHosts]);
    expect(serving?.cors).toEqual({ origin: true });
    expect(serving?.host).toBe(true);
    expect(serving?.port).toBe(34204);
  }
  const plugin = config.plugins?.[0] as Plugin;
  expect(plugin.configureServer).toBeTypeOf("function");
  expect(plugin.configurePreviewServer).toBeTypeOf("function");
});
