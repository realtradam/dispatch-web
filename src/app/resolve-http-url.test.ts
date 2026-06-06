import { describe, expect, it } from "vitest";
import { resolveHttpUrl } from "./resolve-http-url";

describe("resolveHttpUrl", () => {
	it("explicit url wins over everything", () => {
		const result = resolveHttpUrl(
			{ VITE_HTTP_URL: "https://env.example.com:9999" },
			{ protocol: "https:", hostname: "page.example.com" },
		);
		expect(result).toBe("https://env.example.com:9999");
	});

	it("VITE_HTTP_URL wins over derivation", () => {
		const result = resolveHttpUrl(
			{ VITE_HTTP_URL: "https://env.example.com:8888" },
			{ protocol: "http:", hostname: "page.example.com" },
		);
		expect(result).toBe("https://env.example.com:8888");
	});

	it("derives http://<hostname>:24203 from http location", () => {
		const result = resolveHttpUrl({}, { protocol: "http:", hostname: "100.126.75.103" });
		expect(result).toBe("http://100.126.75.103:24203");
	});

	it("derives https://<hostname>:24203 from https location", () => {
		const result = resolveHttpUrl({}, { protocol: "https:", hostname: "arch-razer" });
		expect(result).toBe("https://arch-razer:24203");
	});

	it("uses VITE_HTTP_PORT when set", () => {
		const result = resolveHttpUrl(
			{ VITE_HTTP_PORT: "3000" },
			{ protocol: "http:", hostname: "localhost" },
		);
		expect(result).toBe("http://localhost:3000");
	});

	it("falls back to http://localhost:24203 when location is missing", () => {
		const result = resolveHttpUrl({});
		expect(result).toBe("http://localhost:24203");
	});

	it("VITE_HTTP_URL empty string treated as unset", () => {
		const result = resolveHttpUrl({ VITE_HTTP_URL: "" }, { protocol: "http:", hostname: "myhost" });
		expect(result).toBe("http://myhost:24203");
	});

	it("VITE_HTTP_PORT empty string falls back to default", () => {
		const result = resolveHttpUrl(
			{ VITE_HTTP_PORT: "" },
			{ protocol: "http:", hostname: "localhost" },
		);
		expect(result).toBe("http://localhost:24203");
	});
});
