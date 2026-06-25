import type { WorkspaceEntry } from "@dispatch/wire";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceResult } from "../adapter/http";
import type { WorkspaceStore } from "../store.svelte";
import WorkspaceCard from "./WorkspaceCard.svelte";

function fakeEntry(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
	return {
		id: "my-ws",
		title: "My Workspace",
		defaultCwd: null,
		createdAt: 1,
		lastActivityAt: 2,
		conversationCount: 3,
		...overrides,
	};
}

/** A fake store that records calls + resolves ok. */
function fakeStore() {
	return {
		rename: vi.fn(
			async (id: string, _title: string): Promise<WorkspaceResult<WorkspaceEntry>> => ({
				ok: true,
				value: fakeEntry({ id, title: _title }),
			}),
		),
		setDefaultCwd: vi.fn(
			async (id: string, defaultCwd: string | null): Promise<WorkspaceResult<WorkspaceEntry>> => ({
				ok: true,
				value: fakeEntry({ id, defaultCwd }),
			}),
		),
		remove: vi.fn(
			async (): Promise<WorkspaceResult<{ closedCount: number }>> => ({
				ok: true,
				value: { closedCount: 0 },
			}),
		),
	};
}

describe("WorkspaceCard", () => {
	it("renders the title, slug, and an Open link", () => {
		const store = fakeStore() as unknown as WorkspaceStore;
		render(WorkspaceCard, {
			props: { ws: fakeEntry(), store },
		});
		expect(screen.getByText("My Workspace")).toBeInTheDocument();
		expect(screen.getByText("/my-ws")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/my-ws");
	});

	it("double-clicking the title reveals an edit input", async () => {
		const user = userEvent.setup();
		const store = fakeStore() as unknown as WorkspaceStore;
		render(WorkspaceCard, { props: { ws: fakeEntry(), store } });

		await user.dblClick(screen.getByText("My Workspace"));
		expect(screen.getByLabelText("Workspace title")).toHaveValue("My Workspace");
	});

	it("renames via the store on Enter", async () => {
		const user = userEvent.setup();
		const store = fakeStore() as unknown as WorkspaceStore;
		render(WorkspaceCard, { props: { ws: fakeEntry(), store } });

		await user.dblClick(screen.getByText("My Workspace"));
		const input = screen.getByLabelText("Workspace title");
		await user.clear(input);
		await user.type(input, "Renamed{Enter}");

		expect(store.rename).toHaveBeenCalledWith("my-ws", "Renamed");
	});

	it("enables Set only when the cwd differs, then saves it", async () => {
		const user = userEvent.setup();
		const store = fakeStore() as unknown as WorkspaceStore;
		render(WorkspaceCard, {
			props: { ws: fakeEntry({ defaultCwd: "/old" }), store },
		});

		const input = screen.getByLabelText("Default working directory");
		expect(input).toHaveValue("/old");
		expect(screen.getByRole("button", { name: "Set" })).toBeDisabled();

		await user.clear(input);
		await user.type(input, "/new/path");
		expect(screen.getByRole("button", { name: "Set" })).toBeEnabled();

		await user.click(screen.getByRole("button", { name: "Set" }));
		expect(store.setDefaultCwd).toHaveBeenCalledWith("my-ws", "/new/path");
	});

	it("clears the cwd to null when saved empty (inherits the server default)", async () => {
		const user = userEvent.setup();
		const store = fakeStore() as unknown as WorkspaceStore;
		render(WorkspaceCard, {
			props: { ws: fakeEntry({ defaultCwd: "/old" }), store },
		});

		const input = screen.getByLabelText("Default working directory");
		await user.clear(input);
		await user.click(screen.getByRole("button", { name: "Set" }));

		expect(store.setDefaultCwd).toHaveBeenCalledWith("my-ws", null);
	});

	it("the Open link opens the workspace in a new browser tab (no same-tab navigation)", () => {
		const store = fakeStore() as unknown as WorkspaceStore;
		render(WorkspaceCard, { props: { ws: fakeEntry(), store } });

		const open = screen.getByRole("link", { name: "Open" });
		// Native new-tab link: href points at the workspace, and target="_blank"
		// opens it in a new browser tab rather than client-side navigating.
		expect(open).toHaveAttribute("href", "/my-ws");
		expect(open).toHaveAttribute("target", "_blank");
		expect(open.getAttribute("rel") ?? "").toMatch(/noopener/);
	});
});
