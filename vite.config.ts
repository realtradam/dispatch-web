import { execFileSync, execSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

console.log("[spike] config module evaluated");

import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig, type Plugin, type UserConfig } from "vitest/config";
import {
  buildAllowedHosts,
  checkDevRequest,
  type DevNetworkPolicy,
  normalizeHost,
  normalizeHostHeader,
  tailscaleSelf,
} from "./scripts/network-policy";

async function secureDevConfig(config: UserConfig, serving: boolean): Promise<UserConfig> {
  // Build/test have no listener and need no subprocess or DNS effects.
  if (!serving) return config;
  const network = await detectDevNetworkPolicy();
  return {
    ...config,
    plugins: [devNetworkGuard(network), ...(config.plugins ?? [])],
    server: {
      ...config.server,
      allowedHosts: [...network.allowedHosts],
      // Safe reflection: our guard rejects disallowed Origins before Vite's CORS.
      cors: { origin: true },
    },
  };
}

async function detectDevNetworkPolicy(): Promise<DevNetworkPolicy> {
  let tailscaleStatusJson: string | undefined;
  try {
    tailscaleStatusJson = execFileSync("tailscale", ["status", "--self", "--json"], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    console.warn(
      "[network] Tailscale detection unavailable; using loopback and explicit env hosts",
    );
  }
  const allowedHosts = new Set(
    buildAllowedHosts({
      ...(tailscaleStatusJson !== undefined ? { tailscaleStatusJson } : {}),
      env: {
        ...(process.env.DISPATCH_ALLOWED_HOSTS !== undefined
          ? { DISPATCH_ALLOWED_HOSTS: process.env.DISPATCH_ALLOWED_HOSTS }
          : {}),
        ...(process.env.DISPATCH_TAILSCALE_NAME !== undefined
          ? { DISPATCH_TAILSCALE_NAME: process.env.DISPATCH_TAILSCALE_NAME }
          : {}),
      },
    }),
  );
  const self = tailscaleSelf(tailscaleStatusJson);
  if (self.hostName) {
    try {
      const answers = await lookup(self.hostName, { all: true });
      if (answers.some(({ address }) => self.ips.includes(normalizeHost(address)))) {
        const name = normalizeHost(self.hostName);
        if (name) allowedHosts.add(name);
      }
    } catch {
      // The OS hostname is not necessarily the MagicDNS name. Fail closed.
    }
  }
  return { allowedHosts, allowedAddresses: new Set(["127.0.0.1", "::1", ...self.ips]) };
}

function devNetworkGuard(policy: DevNetworkPolicy): Plugin {
  return {
    name: "dispatch-dev-network-guard",
    enforce: "pre",
    configureServer(server) {
      const check = (req: import("node:http").IncomingMessage) =>
        checkDevRequest(
          {
            localAddress: req.socket.localAddress,
            host: req.headers.host,
            origin: req.headers.origin,
          },
          policy,
        );
      server.middlewares.use((req, res, next) => {
        const decision = check(req);
        if (decision !== "ok") {
          res.writeHead(decision.status, { "Content-Type": "text/plain" });
          res.end(decision.reason);
          return;
        }
        // Vite's own check is case-sensitive and doesn't strip trailing dots.
        req.headers.host = normalizeHostHeader(req.headers.host ?? "");
        next();
      });
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

/**
 * SPIKE (plan 03) — the Svelte-runtime import map.
 *
 * Dynamically-imported frontend plugin modules are built STANDALONE with the
 * whole `svelte` package externalized — their bare `svelte` /
 * `svelte/internal/client` imports are resolved in the BROWSER by this import
 * map, which points them at the SAME module instances the host app uses (one
 * Svelte 5 runtime — two runtimes = broken reactivity).
 *
 * - Dev: the aliases below make the app resolve the bare specifiers to
 *   svelte's SOURCE files (stable URLs, no prebundle); the map maps the same
 *   keys to those URLs.
 * - Prod: the two `src/plugin-runtime/*` entry modules are built as their own
 *   chunks whose exports ARE the app's module instances (one rollup graph);
 *   the map maps the keys to the emitted chunk files.
 */
const svelteApiEntry = fileURLToPath(
  new URL("./src/plugin-runtime/svelte-api.ts", import.meta.url),
);
const svelteInternalEntry = fileURLToPath(
  new URL("./src/plugin-runtime/svelte-internal-client.ts", import.meta.url),
);

function svelteRuntimeImportMap(): Plugin {
  /** Build-time map: the emitted runtime-entry chunk file names. */
  const prodMap: Record<string, string> = {};
  return {
    name: "dispatch-svelte-runtime-import-map",
    transformIndexHtml: {
      // Post + head-prepend: runs AFTER generateBundle (so the build-time
      // chunk capture is available) and still lands the import map as the
      // FIRST head child — before any module script (the import-map spec
      // requirement).
      order: "post",
      handler(html) {
        let imports: Record<string, string> = {};
        if (Object.keys(prodMap).length > 0) {
          imports = prodMap;
        } else {
          // Serve (or a build where the runtime entries were dropped): map
          // to the alias targets — svelte's source files, with the dep
          // optimizer's browserHash so the URLs are identical to the app's
          // own imports.
          const hash = readBrowserHash();
          const targets: Record<string, string> = {
            svelte: "/node_modules/svelte/src/index-client.js",
            "svelte/internal/client": "/node_modules/svelte/src/internal/client/index.js",
            "svelte/internal/disclose-version":
              "/node_modules/svelte/src/internal/disclose-version.js",
            "svelte/internal/flags/legacy": "/node_modules/svelte/src/internal/flags/legacy.js",
            "svelte/store": "/node_modules/svelte/src/store/index-client.js",
          };
          for (const [key, path] of Object.entries(targets)) {
            imports[key] = `${path}${hash === null ? "" : `?v=${hash}`}`;
          }
        }
        return {
          html,
          tags: [
            {
              tag: "script",
              attrs: { type: "importmap" },
              children: JSON.stringify({ imports }),
              injectTo: "head-prepend",
            },
          ],
        };
      },
    },
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") continue;
        const facade = (chunk.facadeModuleId ?? "").split("?")[0];
        if (facade === svelteApiEntry) prodMap.svelte = `/${fileName}`;
        if (facade === svelteInternalEntry) {
          prodMap["svelte/internal/client"] = `/${fileName}`;
        }
      }
    },
  };
}

/** Read the dep optimizer's browserHash from its on-disk metadata (dev only). */
function readBrowserHash(): string | null {
  try {
    const meta = JSON.parse(
      readFileSync(new URL("./node_modules/.vite/deps/_metadata.json", import.meta.url), "utf8"),
    ) as { browserHash?: string };
    return meta.browserHash ?? null;
  } catch {
    return null;
  }
}

// Dev server on the reserved FRONTEND_PORT (24204). Vitest config lives here too
// (jsdom + globals) so component tests run without extra config.
const config: UserConfig = {
  // svelteTesting() forces Svelte's `browser` resolve condition under vitest so
  // component render()/mount() works in jsdom (a plain test.resolve.conditions
  // does not propagate to Vite's SSR resolution — sveltejs/svelte#11394).
  plugins: [tailwindcss(), svelte(), svelteTesting(), svelteRuntimeImportMap()],
  // Vite has one bind: destination-interface guards restrict HTTP + HMR to
  // loopback / detected Tailscale IPs despite the dual-stack wildcard listener.
  // Env host extras are additive and DISPATCH_BIND cannot widen this guard.
  server: { port: 24204, host: true, allowedHosts: ["localhost", "127.0.0.1", "::1"] },
  // SPIKE (plan 03): resolve the bare Svelte specifiers to svelte's SOURCE
  // files — stable dev URLs the import map points the plugin's bare imports
  // at (one shared runtime instance; no prebundle copy of svelte).
  resolve: {
    alias: [
      {
        find: /^svelte$/,
        replacement: fileURLToPath(
          new URL("./node_modules/svelte/src/index-client.js", import.meta.url),
        ),
      },
      {
        find: /^svelte\/internal\/client$/,
        replacement: fileURLToPath(
          new URL("./node_modules/svelte/src/internal/client/index.js", import.meta.url),
        ),
      },
      {
        find: /^svelte\/internal\/disclose-version$/,
        replacement: fileURLToPath(
          new URL("./node_modules/svelte/src/internal/disclose-version.js", import.meta.url),
        ),
      },
      {
        find: /^svelte\/internal\/flags\/legacy$/,
        replacement: fileURLToPath(
          new URL("./node_modules/svelte/src/internal/flags/legacy.js", import.meta.url),
        ),
      },
      {
        find: /^svelte\/store$/,
        replacement: fileURLToPath(
          new URL("./node_modules/svelte/src/store/index-client.js", import.meta.url),
        ),
      },
    ],
  },
  // SPIKE (plan 03): never prebundle svelte — the app must resolve it to the
  // SAME source URLs the import map hands the plugin's bare imports.
  optimizeDeps: {
    exclude: [
      "svelte",
      "svelte/internal/client",
      "svelte/internal/disclose-version",
      "svelte/internal/flags/legacy",
      "svelte/store",
    ],
  },
  build: {
    rollupOptions: {
      // plan 03: keep ENTRY exports in full — the plugin-runtime entries
      // (`svelte-api` / `svelte-internal-client`) are the import map's
      // targets, and vite's default `preserveEntrySignatures: false` lets
      // rollup tree-shake entry exports no other chunk imports (leaving only
      // the bindings the app happens to use). Their exports must be the FULL
      // svelte API: a plugin may import bindings the app never uses.
      preserveEntrySignatures: "strict",
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        "svelte-api": svelteApiEntry,
        "svelte-internal-client": svelteInternalEntry,
      },
    },
  },
  define: {
    // Bake the 5-char git short hash at build time so it survives bundling
    // (incl. arch package deploys). Falls back to "dev" when not in a git repo.
    __APP_VERSION__: JSON.stringify(getGitShortHash()),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest-setup.ts"],
  },
};

export default defineConfig(async ({ command }) =>
  secureDevConfig(config, command === "serve" && !process.env.VITEST),
);

function getGitShortHash(): string {
  try {
    return execSync("git rev-parse --short=5 HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "dev";
  }
}
