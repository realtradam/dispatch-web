import type { LspServerInfo } from "@dispatch/transport-contract";
import { describe, expect, it } from "vitest";
import {
	cwdChanged,
	isSubmittableCwd,
	normalizeCwd,
	summarizeServers,
	viewLspServer,
	viewLspServers,
} from "./view-model";

const server = (over: Partial<LspServerInfo> = {}): LspServerInfo => ({
	id: "typescript",
	name: "TypeScript",
	root: "/home/me/project",
	extensions: [".ts", ".tsx"],
	state: "connected",
	...over,
});

describe("cwd helpers", () => {
	it("normalizeCwd trims surrounding whitespace", () => {
		expect(normalizeCwd("  /a/b  ")).toBe("/a/b");
		expect(normalizeCwd("\t/x\n")).toBe("/x");
	});

	it("isSubmittableCwd is false for empty / whitespace-only", () => {
		expect(isSubmittableCwd("")).toBe(false);
		expect(isSubmittableCwd("   ")).toBe(false);
		expect(isSubmittableCwd("/a")).toBe(true);
	});

	it("cwdChanged: true only when a non-empty trimmed value differs from current", () => {
		expect(cwdChanged("/a/b", null)).toBe(true);
		expect(cwdChanged("/a/b", "/a/b")).toBe(false);
		expect(cwdChanged("  /a/b  ", "/a/b")).toBe(false); // trim-equal → no change
		expect(cwdChanged("/a/c", "/a/b")).toBe(true);
		expect(cwdChanged("", "/a/b")).toBe(false); // empty is not a change (can't clear)
		expect(cwdChanged("   ", null)).toBe(false);
	});
});

describe("viewLspServer", () => {
	it("connected → success badge, not busy, no error", () => {
		const v = viewLspServer(server({ state: "connected" }));
		expect(v.badge).toBe("success");
		expect(v.statusLabel).toBe("Connected");
		expect(v.busy).toBe(false);
		expect(v.error).toBeNull();
		expect(v.extensionsLabel).toBe(".ts .tsx");
	});

	it("starting / not-started → busy (spinner) with warning / neutral badge", () => {
		const starting = viewLspServer(server({ state: "starting" }));
		expect(starting.badge).toBe("warning");
		expect(starting.busy).toBe(true);

		const notStarted = viewLspServer(server({ state: "not-started" }));
		expect(notStarted.badge).toBe("neutral");
		expect(notStarted.busy).toBe(true);
	});

	it("error → error badge + surfaces the reason (with a fallback)", () => {
		const withReason = viewLspServer(server({ state: "error", error: "ENOENT" }));
		expect(withReason.badge).toBe("error");
		expect(withReason.busy).toBe(false);
		expect(withReason.error).toBe("ENOENT");

		const noReason = viewLspServer(server({ state: "error" }));
		expect(noReason.error).toBe("Failed to start");
	});

	it("viewLspServers maps a list preserving order", () => {
		const views = viewLspServers([server({ id: "a" }), server({ id: "b" })]);
		expect(views.map((v) => v.id)).toEqual(["a", "b"]);
	});
});

describe("summarizeServers", () => {
	it("empty list", () => {
		expect(summarizeServers([])).toBe("No language servers");
	});

	it("counts connected / starting / errors", () => {
		expect(summarizeServers([server({ state: "connected" })])).toBe("1 connected");
		expect(
			summarizeServers([
				server({ id: "a", state: "connected" }),
				server({ id: "b", state: "error" }),
			]),
		).toBe("1 connected, 1 error");
		expect(
			summarizeServers([
				server({ id: "a", state: "connected" }),
				server({ id: "b", state: "starting" }),
				server({ id: "c", state: "error" }),
				server({ id: "d", state: "error" }),
			]),
		).toBe("1 connected, 1 starting, 2 errors");
	});
});
