import type { ComputerStatusResponse, TestComputerResponse } from "@dispatch/transport-contract";
import type { ComputerEntry } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import {
	formatHost,
	knownHostLabel,
	summarizeComputers,
	viewComputer,
	viewComputerStatus,
	viewComputers,
	viewTestResult,
} from "./view-model";

function computer(overrides: Partial<ComputerEntry> = {}): ComputerEntry {
	return {
		alias: "buildbox",
		hostName: "10.0.0.5",
		port: 22,
		user: "deploy",
		identityFile: "/home/deploy/.ssh/id_ed25519",
		knownHost: true,
		usageCount: 0,
		...overrides,
	};
}

describe("formatHost", () => {
	it("is user@host with no port when port is the SSH default (22)", () => {
		expect(formatHost(computer({ port: 22 }))).toBe("deploy@10.0.0.5");
	});

	it("appends a non-default port", () => {
		expect(formatHost(computer({ port: 2222 }))).toBe("deploy@10.0.0.5:2222");
	});

	it("falls back to the alias when hostName is empty", () => {
		expect(formatHost(computer({ hostName: "" }))).toBe("deploy@buildbox");
	});
});

describe("knownHostLabel", () => {
	it("is 'known host' when known", () => {
		expect(knownHostLabel(true)).toBe("known host");
	});

	it("is 'new host' when not known", () => {
		expect(knownHostLabel(false)).toBe("new host");
	});
});

describe("viewComputer", () => {
	it("projects alias + hostSummary + identity + known-host label", () => {
		const v = viewComputer(computer());
		expect(v.alias).toBe("buildbox");
		expect(v.hostSummary).toBe("deploy@10.0.0.5");
		expect(v.identityFile).toBe("/home/deploy/.ssh/id_ed25519");
		expect(v.knownHostLabel).toBe("known host");
		expect(v.knownHost).toBe(true);
	});

	it("preserves a null identityFile (default key)", () => {
		const v = viewComputer(computer({ identityFile: null }));
		expect(v.identityFile).toBeNull();
	});
});

describe("viewComputers", () => {
	it("maps each entry (and drops usageCount from the view)", () => {
		const views = viewComputers([
			computer({ alias: "a", usageCount: 3 }),
			computer({ alias: "b", hostName: "b.local", usageCount: 0 }),
		]);
		expect(views).toHaveLength(2);
		expect(views.at(0)?.alias).toBe("a");
		expect(views.at(1)?.hostSummary).toBe("deploy@b.local");
	});
});

describe("summarizeComputers", () => {
	it("is 'No computers discovered' for an empty list", () => {
		expect(summarizeComputers([])).toBe("No computers discovered");
	});

	it("is singular for one computer", () => {
		expect(summarizeComputers([computer()])).toBe("1 computer");
	});

	it("is plural for many", () => {
		expect(summarizeComputers([computer(), computer(), computer()])).toBe("3 computers");
	});
});

describe("viewComputerStatus", () => {
	function status(
		state: ComputerStatusResponse["state"],
		overrides: Partial<ComputerStatusResponse> = {},
	): ComputerStatusResponse {
		return { alias: "buildbox", state, knownHost: true, ...overrides };
	}

	it("connected → success badge, not busy, no error", () => {
		const v = viewComputerStatus(status("connected"));
		expect(v.statusLabel).toBe("Connected");
		expect(v.badge).toBe("success");
		expect(v.busy).toBe(false);
		expect(v.error).toBeNull();
	});

	it("connecting → warning badge + busy (spinner), no error", () => {
		const v = viewComputerStatus(status("connecting"));
		expect(v.statusLabel).toBe("Connecting…");
		expect(v.badge).toBe("warning");
		expect(v.busy).toBe(true);
		expect(v.error).toBeNull();
	});

	it("disconnected → neutral badge, NOT busy (a stable idle state)", () => {
		const v = viewComputerStatus(status("disconnected"));
		expect(v.statusLabel).toBe("Disconnected");
		expect(v.badge).toBe("neutral");
		expect(v.busy).toBe(false);
		expect(v.error).toBeNull();
	});

	it("error → error badge, not busy, surfaces the reason", () => {
		const v = viewComputerStatus(status("error", { error: "auth refused" }));
		expect(v.statusLabel).toBe("Error");
		expect(v.badge).toBe("error");
		expect(v.busy).toBe(false);
		expect(v.error).toBe("auth refused");
	});

	it("error falls back to a default reason when the backend omits one", () => {
		const v = viewComputerStatus(status("error"));
		expect(v.error).toBe("Connection failed");
	});

	it("carries the knownHost flag through", () => {
		const v = viewComputerStatus(status("connected", { knownHost: false }));
		expect(v.knownHost).toBe(false);
	});
});

describe("viewTestResult", () => {
	it("ok=true → no error, 'Connection OK' label", () => {
		const r = viewTestResult({ alias: "buildbox", ok: true } as TestComputerResponse);
		expect(r.ok).toBe(true);
		expect(r.error).toBeNull();
		expect(r.label).toBe("Connection OK");
	});

	it("ok=false → surfaces the failure reason", () => {
		const r = viewTestResult({
			alias: "buildbox",
			ok: false,
			error: "host unreachable",
		} as TestComputerResponse);
		expect(r.ok).toBe(false);
		expect(r.error).toBe("host unreachable");
		expect(r.label).toBe("Failed");
	});

	it("ok=false without a reason falls back to a default", () => {
		const r = viewTestResult({ alias: "buildbox", ok: false } as TestComputerResponse);
		expect(r.error).toBe("Connection failed");
	});
});
