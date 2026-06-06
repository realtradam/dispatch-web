import { describe, expect, it } from "vitest";
import { applyServerMessage, initialState, invoke, subscribe, unsubscribe } from "./reducer";

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
		const result = subscribe(s, "s1");
		s = result.state;
		const spec = makeSpec("s1", "Surface 1");
		const next = applyServerMessage(s, { type: "surface", spec });
		expect(next.subscriptions.get("s1")).toEqual(spec);
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
		expect(next.subscriptions.get("s1")?.title).toBe("V2");
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
	it("emits exactly one subscribe message", () => {
		const s = initialState();
		const result = subscribe(s, "s1");
		expect(result.outgoing).toEqual([{ type: "subscribe", surfaceId: "s1" }]);
		expect(result.outgoing).toHaveLength(1);
	});

	it("adds the surface to subscriptions with null spec", () => {
		const s = initialState();
		const result = subscribe(s, "s1");
		expect(result.state.subscriptions.get("s1")).toBeNull();
	});

	it("is idempotent — second subscribe is a no-op", () => {
		let s = initialState();
		s = subscribe(s, "s1").state;
		const result = subscribe(s, "s1");
		expect(result.outgoing).toEqual([]);
		expect(result.state).toBe(s);
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

	it("does not mutate state", () => {
		const s = initialState();
		const result = invoke(s, "s1", "a1");
		expect(result.state).toBe(s);
	});
});
