import { describe, expect, it } from "vitest";
import {
	createSmartScrollState,
	isNearBottom,
	NEAR_BOTTOM_THRESHOLD,
	onContentChange,
	onReset,
	onResume,
	onScroll,
	type ScrollGeometry,
} from "./smart-scroll";

// A viewport 100px tall over 1000px of content: scrollTop 900 == pinned to bottom.
const atBottom: ScrollGeometry = { scrollTop: 900, scrollHeight: 1000, clientHeight: 100 };
const nearBottom: ScrollGeometry = {
	scrollTop: 900 - NEAR_BOTTOM_THRESHOLD,
	scrollHeight: 1000,
	clientHeight: 100,
};
const scrolledUp: ScrollGeometry = { scrollTop: 200, scrollHeight: 1000, clientHeight: 100 };

describe("isNearBottom", () => {
	it("is true exactly at the bottom", () => {
		expect(isNearBottom(atBottom)).toBe(true);
	});

	it("is true within the threshold of the bottom", () => {
		expect(isNearBottom(nearBottom)).toBe(true);
	});

	it("is false just beyond the threshold", () => {
		expect(
			isNearBottom({
				scrollTop: 900 - NEAR_BOTTOM_THRESHOLD - 1,
				scrollHeight: 1000,
				clientHeight: 100,
			}),
		).toBe(false);
	});

	it("is false when scrolled well up", () => {
		expect(isNearBottom(scrolledUp)).toBe(false);
	});

	it("honours a custom threshold", () => {
		const geom: ScrollGeometry = { scrollTop: 800, scrollHeight: 1000, clientHeight: 100 };
		expect(isNearBottom(geom, 50)).toBe(false);
		expect(isNearBottom(geom, 150)).toBe(true);
	});
});

describe("smart-scroll reducer", () => {
	it("starts stuck and hides the button", () => {
		const s = createSmartScrollState();
		expect(s.stuck).toBe(true);
	});

	it("onScroll up unsticks and shows the button, with no command", () => {
		const r = onScroll(createSmartScrollState(), scrolledUp);
		expect(r.state.stuck).toBe(false);
		expect(r.showButton).toBe(true);
		expect(r.command).toBeNull();
	});

	it("onScroll back to the bottom re-sticks and hides the button", () => {
		const up = onScroll(createSmartScrollState(), scrolledUp).state;
		const r = onScroll(up, atBottom);
		expect(r.state.stuck).toBe(true);
		expect(r.showButton).toBe(false);
		expect(r.command).toBeNull();
	});

	it("onContentChange while stuck emits a NON-animated scroll (keep up with the stream)", () => {
		const r = onContentChange(createSmartScrollState(), atBottom);
		expect(r.command).toEqual({ kind: "scroll-to-bottom", animate: false });
		expect(r.state.stuck).toBe(true);
	});

	it("onContentChange while unstuck emits NO command (leave the reader in place)", () => {
		const up = onScroll(createSmartScrollState(), scrolledUp).state;
		const r = onContentChange(up, scrolledUp);
		expect(r.command).toBeNull();
		expect(r.state.stuck).toBe(false);
		expect(r.showButton).toBe(true);
	});

	it("onResume re-sticks and emits an ANIMATED scroll", () => {
		const up = onScroll(createSmartScrollState(), scrolledUp).state;
		const r = onResume(up);
		expect(r.state.stuck).toBe(true);
		expect(r.showButton).toBe(false);
		expect(r.command).toEqual({ kind: "scroll-to-bottom", animate: true });
	});

	it("onReset returns to stuck and snaps (non-animated) to the bottom", () => {
		const up = onScroll(createSmartScrollState(), scrolledUp).state;
		const r = onReset();
		void up;
		expect(r.state.stuck).toBe(true);
		expect(r.command).toEqual({ kind: "scroll-to-bottom", animate: false });
		expect(r.showButton).toBe(false);
	});
});
