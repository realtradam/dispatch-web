import type { IncomingMessage } from "node:http";
import type { Plugin, UserConfig } from "vite";
import { checkDevRequest, type DevNetworkPolicy, normalizeHostHeader } from "./network-policy";

/** Explicitly protect BOTH serving modes; preview must not inherit permissive CORS alone. */
export function applyViteNetworkPolicy(config: UserConfig, network: DevNetworkPolicy): UserConfig {
  return {
    ...config,
    plugins: [devNetworkGuard(network), ...(config.plugins ?? [])],
    server: {
      ...config.server,
      allowedHosts: [...network.allowedHosts],
      // Safe reflection only after our pre-middleware validates the Origin.
      cors: { origin: true },
    },
    preview: {
      ...config.preview,
      allowedHosts: [...network.allowedHosts],
      cors: { origin: true },
    },
  };
}

export function devNetworkGuard(policy: DevNetworkPolicy): Plugin {
  const check = (req: IncomingMessage) =>
    checkDevRequest(
      {
        localAddress: req.socket.localAddress,
        host: req.headers.host,
        origin: req.headers.origin,
      },
      policy,
    );
  // Installed before Vite's CORS, host check and static-file middleware in
  // either mode. No post-hook: even preflights and error responses are guarded.
  const middleware: import("vite").Connect.NextHandleFunction = (req, res, next) => {
    const decision = check(req);
    if (decision !== "ok") {
      res.writeHead(decision.status, { "Content-Type": "text/plain" });
      res.end(decision.reason);
      return;
    }
    req.headers.host = normalizeHostHeader(req.headers.host ?? "");
    next();
  };
  return {
    name: "dispatch-dev-network-guard",
    enforce: "pre",
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    configureServer(server) {
      server.middlewares.use(middleware);
      // Vite registers HMR before configureServer. Wrap (rather than prepend to)
      // its listeners: EventEmitter otherwise continues into HMR after a denial.
      const http = server.httpServer;
      if (http) {
        const upgrades = http.listeners("upgrade");
        http.removeAllListeners("upgrade");
        http.on("upgrade", (req, socket, head) => {
          const decision = check(req);
          if (decision !== "ok") {
            socket.end(
              `HTTP/1.1 ${decision.status} ${decision.status === 421 ? "Misdirected Request" : "Forbidden"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
            );
            return;
          }
          req.headers.host = normalizeHostHeader(req.headers.host ?? "");
          for (const upgrade of upgrades) upgrade.call(http, req, socket, head);
        });
      }
    },
  };
}
