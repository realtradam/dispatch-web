import type { SurfaceServerMessage } from "@dispatch/ui-contract";
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { WebSocketLike } from "../adapters/ws";
import App from "./App.svelte";
import { createAppStore } from "./store.svelte";

interface FakeSocket extends WebSocketLike {
	sent: string[];
	resolveOpen(): void;
	feedMessage(data: SurfaceServerMessage): void;
}

function fakeSocket(): FakeSocket {
	let onopen: (() => void) | null = null;
	let onmessage: ((ev: { data: string }) => void) | null = null;
	const sent: string[] = [];

	const ws: FakeSocket = {
		send(data: string) {
			sent.push(data);
		},
		close() {},
		get onopen() {
			return onopen;
		},
		set onopen(fn) {
			onopen = fn;
		},
		get onmessage() {
			return onmessage;
		},
		set onmessage(fn) {
			onmessage = fn;
		},
		get onclose() {
			return null;
		},
		set onclose(_fn) {},
		resolveOpen() {
			onopen?.();
		},
		feedMessage(msg: SurfaceServerMessage) {
			onmessage?.({ data: JSON.stringify(msg) });
		},
		sent,
	};
	return ws;
}

function sentMessages(ws: FakeSocket) {
	return ws.sent.map((s) => JSON.parse(s));
}

describe("App component interaction tests", () => {
	it("renders empty state when catalog is empty", () => {
		const ws = fakeSocket();
		const store = createAppStore({ socketFactory: () => ws });
		ws.resolveOpen();

		render(App, { props: { store } });

		expect(screen.getByText("No surfaces available")).toBeInTheDocument();

		store.dispose();
	});

	it("renders a catalog button per entry after a catalog message", () => {
		const ws = fakeSocket();
		const store = createAppStore({ socketFactory: () => ws });
		ws.resolveOpen();

		ws.feedMessage({
			type: "catalog",
			catalog: [
				{ id: "s1", region: "sidebar", title: "Surface One" },
				{ id: "s2", region: "panel", title: "Surface Two" },
			],
		});

		render(App, { props: { store } });

		const buttons = screen.getAllByRole("button");
		expect(buttons).toHaveLength(2);
		expect(buttons[0]).toHaveTextContent("Surface One");
		expect(buttons[1]).toHaveTextContent("Surface Two");

		store.dispose();
	});

	it("clicking a catalog entry subscribes and renders its surface", async () => {
		const ws = fakeSocket();
		const store = createAppStore({ socketFactory: () => ws });
		ws.resolveOpen();

		ws.feedMessage({
			type: "catalog",
			catalog: [{ id: "s1", region: "sidebar", title: "Surface One" }],
		});

		render(App, { props: { store } });

		const user = userEvent.setup();
		const button = screen.getByRole("button", { name: /Surface One/ });
		ws.sent.length = 0;
		await user.click(button);

		const msgs = sentMessages(ws);
		const subscribe = msgs.find(
			(m: { type: string; surfaceId: string }) => m.type === "subscribe" && m.surfaceId === "s1",
		);
		expect(subscribe).toBeTruthy();

		ws.feedMessage({
			type: "surface",
			spec: {
				id: "s1",
				region: "sidebar",
				title: "Surface One",
				fields: [{ kind: "stat", label: "Tokens", value: "1,234" }],
			},
		});

		expect(await screen.findByRole("heading", { name: "Surface One" })).toBeInTheDocument();
		expect(await screen.findByText("Tokens")).toBeInTheDocument();
		expect(await screen.findByText("1,234")).toBeInTheDocument();

		store.dispose();
	});

	it("clicking a different entry unsubscribes the previous then subscribes the new", async () => {
		const ws = fakeSocket();
		const store = createAppStore({ socketFactory: () => ws });
		ws.resolveOpen();

		ws.feedMessage({
			type: "catalog",
			catalog: [
				{ id: "s1", region: "sidebar", title: "Surface One" },
				{ id: "s2", region: "panel", title: "Surface Two" },
			],
		});

		render(App, { props: { store } });

		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /Surface One/ }));
		ws.sent.length = 0;

		await user.click(screen.getByRole("button", { name: /Surface Two/ }));

		const msgs = sentMessages(ws) as Array<{ type: string; surfaceId: string }>;
		const unsubIdx = msgs.findIndex((m) => m.type === "unsubscribe" && m.surfaceId === "s1");
		const subIdx = msgs.findIndex((m) => m.type === "subscribe" && m.surfaceId === "s2");
		expect(unsubIdx).toBeGreaterThanOrEqual(0);
		expect(subIdx).toBeGreaterThanOrEqual(0);
		expect(unsubIdx).toBeLessThan(subIdx);

		store.dispose();
	});

	it("selected catalog button reflects aria-current", async () => {
		const ws = fakeSocket();
		const store = createAppStore({ socketFactory: () => ws });
		ws.resolveOpen();

		ws.feedMessage({
			type: "catalog",
			catalog: [
				{ id: "s1", region: "sidebar", title: "Surface One" },
				{ id: "s2", region: "panel", title: "Surface Two" },
			],
		});

		render(App, { props: { store } });

		const user = userEvent.setup();
		const btn1 = screen.getByRole("button", { name: /Surface One/ });
		const btn2 = screen.getByRole("button", { name: /Surface Two/ });

		await user.click(btn1);
		expect(btn1).toHaveAttribute("aria-current", "true");
		expect(btn2).not.toHaveAttribute("aria-current");

		await user.click(btn2);
		expect(btn2).toHaveAttribute("aria-current", "true");
		expect(btn1).not.toHaveAttribute("aria-current");

		store.dispose();
	});

	it("an error message renders the alert banner", () => {
		const ws = fakeSocket();
		const store = createAppStore({ socketFactory: () => ws });
		ws.resolveOpen();

		ws.feedMessage({
			type: "error",
			message: "Something went wrong",
		});

		render(App, { props: { store } });

		const alert = screen.getByRole("alert");
		expect(alert).toHaveTextContent("Something went wrong");

		store.dispose();
	});

	it("invoking a field action sends an invoke", async () => {
		const ws = fakeSocket();
		const store = createAppStore({ socketFactory: () => ws });
		ws.resolveOpen();

		ws.feedMessage({
			type: "catalog",
			catalog: [{ id: "s1", region: "sidebar", title: "Surface One" }],
		});

		render(App, { props: { store } });

		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /Surface One/ }));

		ws.feedMessage({
			type: "surface",
			spec: {
				id: "s1",
				region: "sidebar",
				title: "Surface One",
				fields: [
					{
						kind: "toggle",
						label: "Dark Mode",
						value: false,
						action: { actionId: "toggle-dark" },
					},
				],
			},
		});

		ws.sent.length = 0;
		const checkbox = await screen.findByRole("checkbox", { name: "Dark Mode" });
		await user.click(checkbox);

		const msgs = sentMessages(ws);
		const invoke = msgs.find(
			(m: { type: string; surfaceId: string; actionId: string; payload: unknown }) =>
				m.type === "invoke" &&
				m.surfaceId === "s1" &&
				m.actionId === "toggle-dark" &&
				m.payload === true,
		);
		expect(invoke).toBeTruthy();

		store.dispose();
	});
});
