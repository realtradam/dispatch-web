import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vitest/config";

// Dev server on the reserved FRONTEND_PORT (24204). Vitest config lives here too
// (jsdom + globals) so component tests run without extra config.
export default defineConfig({
	// svelteTesting() forces Svelte's `browser` resolve condition under vitest so
	// component render()/mount() works in jsdom (a plain test.resolve.conditions
	// does not propagate to Vite's SSR resolution — sveltejs/svelte#11394).
	plugins: [tailwindcss(), svelte(), svelteTesting()],
	// Bind all interfaces + accept any Host header so the dev server is reachable over a LAN /
	// Tailscale. Safe for LOCAL-NETWORK-ONLY use (NOT internet-exposed): `allowedHosts: true`
	// disables Vite's DNS-rebinding host check. (The WS URL still runs in the browser — set
	// VITE_WS_URL to the backend's reachable host when browsing from another device.)
	server: { port: 24204, host: true, allowedHosts: true },
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./vitest-setup.ts"],
	},
});
