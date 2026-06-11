import { describe, expect, it } from "vitest";
import {
	applyServerMessage,
	getSurfaceSpec,
	initialState,
	invoke,
	subscribe,
	unsubscribe,
} from "./reducer";

const makeSpec = (id: string, title = id) => ({
	id,
	region: "test",
	title,
	fields: [],
});

describe("initialState", () => {
	it("returns empty catalog, no subscriptions, no error", () => {
		const s = initialState();
		expect(s.catalog).toEqual([]);
		expect(s.subscriptions.size).toBe(0);
		expect(s.lastError).toBeNull();
	});
});

describe("applyServerMessage — catalog", () => {
	it("replaces the catalog", () => {
		const s = initialState();
		const catalog = [
			{ id: "a", region: "r", title: "A" },
			{ id: "b", region: "r", title: "B" },
		];
		const next = applyServerMessage(s, { type: "catalog", catalog });
		expect(next.catalog).toEqual(catalog);
	});
});

describe("applyServerMessage — surface", () => {
	it("sets the spec for a subscribed surface", () => {
		let s = initialState();
		s = subscribe(s, "s1").state;
		const spec = makeSpec("s1", "Surface 1");
		const next = applyServerMessage(s, { type: "surface", spec });
		expect(getSurfaceSpec(next, "s1")).toEqual(spec);
	});

	it("ignores a surface message for a non-subscribed surface", () => {
		const s = initialState();
		const spec = makeSpec("unknown");
		const next = applyServerMessage(s, { type: "surface", spec });
		expect(next.subscriptions.has("unknown")).toBe(false);
	});
});

describe("applyServerMessage — update", () => {
	it("replaces spec for a subscribed surface", () => {
		let s = initialState();
		s = subscribe(s, "s1").state;
		s = applyServerMessage(s, { type: "surface", spec: makeSpec("s1", "V1") });
		const next = applyServerMessage(s, {
			type: "update",
			update: { surfaceId: "s1", spec: makeSpec("s1", "V2") },
		});
		expect(getSurfaceSpec(next, "s1")?.title).toBe("V2");
	});

	it("ignores an update for a non-subscribed surface", () => {
		const s = initialState();
		const next = applyServerMessage(s, {
			type: "update",
			update: { surfaceId: "nope", spec: makeSpec("nope") },
		});
		expect(next.subscriptions.has("nope")).toBe(false);
	});
});

describe("applyServerMessage — error", () => {
	it("records the error without throwing", () => {
		const s = initialState();
		const err = { type: "error" as const, surfaceId: "s1", message: "boom" };
		const next = applyServerMessage(s, err);
		expect(next.lastError).toEqual(err);
	});

	it("records error without surfaceId", () => {
		const s = initialState();
		const err = { type: "error" as const, message: "global boom" };
		const next = applyServerMessage(s, err);
		expect(next.lastError).toEqual(err);
	});
});

describe("subscribe", () => {
	it("emits exactly one subscribe message (global, no conversationId)", () => {
		const s = initialState();
		const result = subscribe(s, "s1");
		expect(result.outgoing).toEqual([{ type: "subscribe", surfaceId: "s1" }]);
		expect(result.outgoing).toHaveLength(1);
	});

	it("adds the surface to subscriptions with null spec", () => {
		const s = initialState();
		const result = subscribe(s, "s1");
		expect(result.state.subscriptions.get("s1")).toEqual({
			conversationId: undefined,
			spec: null,
		});
		expect(getSurfaceSpec(result.state, "s1")).toBeNull();
	});

	it("is idempotent — second subscribe with the same scope is a no-op", () => {
		let s = initialState();
		s = subscribe(s, "s1").state;
		const result = subscribe(s, "s1");
		expect(result.outgoing).toEqual([]);
		expect(result.state).toBe(s);
	});
});

describe("subscribe — conversation-scoped", () => {
	it("includes conversationId in the subscribe message", () => {
		const s = initialState();
		const result = subscribe(s, "cache-warming", "conv-A");
		expect(result.outgoing).toEqual([
			{ type: "subscribe", surfaceId: "cache-warming", conversationId: "conv-A" },
		]);
		expect(result.state.subscriptions.get("cache-warming")?.conversationId).toBe("conv-A");
	});

	it("re-scopes on conversation switch: unsubscribe old pair then subscribe new", () => {
		let s = initialState();
		s = subscribe(s, "cw", "conv-A").state;
		s = applyServerMessage(s, {
			type: "surface",
			spec: makeSpec("cw", "A-spec"),
			conversationId: "conv-A",
		});
		const result = subscribe(s, "cw", "conv-B");
		expect(result.outgoing).toEqual([
			{ type: "unsubscribe", surfaceId: "cw", conversationId: "conv-A" },
			{ type: "subscribe", surfaceId: "cw", conversationId: "conv-B" },
		]);
		// previous spec retained until the new one arrives (no flicker)
		expect(getSurfaceSpec(result.state, "cw")?.title).toBe("A-spec");
		expect(result.state.subscriptions.get("cw")?.conversationId).toBe("conv-B");
	});

	it("drops a stale update echoing the previous conversationId", () => {
		let s = initialState();
		s = subscribe(s, "cw", "conv-A").state;
		s = subscribe(s, "cw", "conv-B").state; // re-scoped to B
		const next = applyServerMessage(s, {
			type: "update",
			update: { surfaceId: "cw", spec: makeSpec("cw", "STALE-A"), conversationId: "conv-A" },
		});
		expect(getSurfaceSpec(next, "cw")).toBeNull(); // stale ignored, no spec yet for B
	});

	it("accepts an update echoing the current conversationId", () => {
		let s = initialState();
		s = subscribe(s, "cw", "conv-B").state;
		const next = applyServerMessage(s, {
			type: "update",
			update: { surfaceId: "cw", spec: makeSpec("cw", "B-spec"), conversationId: "conv-B" },
		});
		expect(getSurfaceSpec(next, "cw")?.title).toBe("B-spec");
	});

	it("accepts a global (no-echo) surface message even when subscribed with a conversationId", () => {
		// loaded-extensions is global: server ignores our conversationId and echoes none.
		let s = initialState();
		s = subscribe(s, "loaded-extensions", "conv-A").state;
		const next = applyServerMessage(s, {
			type: "surface",
			spec: makeSpec("loaded-extensions", "Ext"),
		});
		expect(getSurfaceSpec(next, "loaded-extensions")?.title).toBe("Ext");
	});
});

describe("unsubscribe", () => {
	it("emits unsubscribe and drops the spec", () => {
		let s = initialState();
		s = subscribe(s, "s1").state;
		s = applyServerMessage(s, { type: "surface", spec: makeSpec("s1") });
		const result = unsubscribe(s, "s1");
		expect(result.outgoing).toEqual([{ type: "unsubscribe", surfaceId: "s1" }]);
		expect(result.state.subscriptions.has("s1")).toBe(false);
	});

	it("includes conversationId for a scoped subscription", () => {
		let s = initialState();
		s = subscribe(s, "cw", "conv-A").state;
		const result = unsubscribe(s, "cw");
		expect(result.outgoing).toEqual([
			{ type: "unsubscribe", surfaceId: "cw", conversationId: "conv-A" },
		]);
	});

	it("is a no-op if not subscribed", () => {
		const s = initialState();
		const result = unsubscribe(s, "nope");
		expect(result.outgoing).toEqual([]);
		expect(result.state).toBe(s);
	});
});

describe("invoke", () => {
	it("emits the correct InvokeMessage", () => {
		const s = initialState();
		const result = invoke(s, "s1", "toggle", true);
		expect(result.outgoing).toEqual([
			{ type: "invoke", surfaceId: "s1", actionId: "toggle", payload: true },
		]);
	});

	it("omits payload when not provided", () => {
		const s = initialState();
		const result = invoke(s, "s1", "click");
		expect(result.outgoing).toEqual([
			{ type: "invoke", surfaceId: "s1", actionId: "click", payload: undefined },
		]);
	});

	it("includes conversationId when provided", () => {
		const s = initialState();
		const result = invoke(s, "cw", "cache-warming/set-interval", 120, "conv-A");
		expect(result.outgoing).toEqual([
			{
				type: "invoke",
				surfaceId: "cw",
				actionId: "cache-warming/set-interval",
				payload: 120,
				conversationId: "conv-A",
			},
		]);
	});

	it("does not mutate state", () => {
		const s = initialState();
		const result = invoke(s, "s1", "a1");
		expect(result.state).toBe(s);
	});
});
