import { describe, expect, it } from "vitest";
import { resolveWsUrl } from "./resolve-ws-url";

describe("resolveWsUrl", () => {
	it("explicit url wins over everything", () => {
		const result = resolveWsUrl(
			{ VITE_WS_URL: "wss://env.example.com:9999" },
			{ protocol: "https:", hostname: "page.example.com" },
		);
		expect(result).toBe("wss://env.example.com:9999");
	});

	it("VITE_WS_URL wins over derivation", () => {
		const result = resolveWsUrl(
			{ VITE_WS_URL: "wss://env.example.com:9999" },
			{ protocol: "https:", hostname: "page.example.com" },
		);
		expect(result).toBe("wss://env.example.com:9999");
	});

	it("derives ws://<hostname>:24205 from http location", () => {
		const result = resolveWsUrl({}, { protocol: "http:", hostname: "100.126.75.103" });
		expect(result).toBe("ws://100.126.75.103:24205");
	});

	it("derives wss://<hostname>:24205 from https location", () => {
		const result = resolveWsUrl({}, { protocol: "https:", hostname: "arch-razer" });
		expect(result).toBe("wss://arch-razer:24205");
	});

	it("uses VITE_WS_PORT when set", () => {
		const result = resolveWsUrl(
			{ VITE_WS_PORT: "3000" },
			{ protocol: "http:", hostname: "localhost" },
		);
		expect(result).toBe("ws://localhost:3000");
	});

	it("falls back to ws://localhost:24205 when location is missing", () => {
		const result = resolveWsUrl({});
		expect(result).toBe("ws://localhost:24205");
	});

	it("VITE_WS_URL empty string treated as unset", () => {
		const result = resolveWsUrl({ VITE_WS_URL: "" }, { protocol: "http:", hostname: "myhost" });
		expect(result).toBe("ws://myhost:24205");
	});

	it("VITE_WS_PORT empty string falls back to default", () => {
		const result = resolveWsUrl({ VITE_WS_PORT: "" }, { protocol: "http:", hostname: "localhost" });
		expect(result).toBe("ws://localhost:24205");
	});
});
