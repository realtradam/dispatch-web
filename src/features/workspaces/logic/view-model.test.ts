import type { WorkspaceEntry } from "@dispatch/wire";
import { describe, expect, it } from "vitest";
import { pageTitle, relativeTime } from "./view-model";

describe("relativeTime", () => {
	const now = 1_000_000_000_000; // 2001-09-09

	it("is 'now' within a minute", () => {
		expect(relativeTime(now, now)).toBe("now");
		expect(relativeTime(now - 59_000, now)).toBe("now");
	});

	it("is minutes under an hour", () => {
		expect(relativeTime(now - 5 * 60_000, now)).toBe("5m");
		expect(relativeTime(now - 59 * 60_000, now)).toBe("59m");
	});

	it("is hours under a day", () => {
		expect(relativeTime(now - 2 * 60 * 60_000, now)).toBe("2h");
	});

	it("is days under a week", () => {
		expect(relativeTime(now - 3 * 24 * 60 * 60_000, now)).toBe("3d");
	});

	it("is a short date beyond a week", () => {
		// 7+ days ago: just check it is a MM/DD string.
		const s = relativeTime(now - 10 * 24 * 60 * 60_000, now);
		expect(s).toMatch(/^\d{2}\/\d{2}$/);
	});
});

describe("pageTitle", () => {
	// Minimal valid WorkspaceEntry (the irrelevant metadata is zeroed).
	const ws = (id: string, title: string): WorkspaceEntry => ({
		id,
		title,
		defaultCwd: null,
		createdAt: 0,
		lastActivityAt: 0,
		conversationCount: 0,
	});

	it("is 'Dispatch' for the home route", () => {
		expect(pageTitle({ kind: "home" }, [])).toBe("Dispatch");
		expect(pageTitle({ kind: "home" }, [ws("default", "Default")])).toBe("Dispatch");
	});

	it("is 'Dispatch: {title}' for a workspace with a display title", () => {
		const list = [ws("default", "Default"), ws("my-ws", "My Workspace")];
		expect(pageTitle({ kind: "workspace", id: "my-ws" }, list)).toBe("Dispatch: My Workspace");
	});

	it("falls back to the slug (id) until the list has loaded the workspace", () => {
		expect(pageTitle({ kind: "workspace", id: "pending" }, [])).toBe("Dispatch: pending");
	});

	it("uses the id as the title when it was never customized (defaults to id)", () => {
		const list = [ws("default", "default")];
		expect(pageTitle({ kind: "workspace", id: "default" }, list)).toBe("Dispatch: default");
	});

	it("matches by id, not title", () => {
		const list = [ws("a", "shared-title"), ws("b", "shared-title")];
		expect(pageTitle({ kind: "workspace", id: "b" }, list)).toBe("Dispatch: shared-title");
	});
});
