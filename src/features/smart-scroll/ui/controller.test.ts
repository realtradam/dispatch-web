import { describe, expect, it, vi } from "vitest";
import { createSmartScrollController } from "./controller.svelte";

// A minimal fake of the only DOM surface the controller touches: scroll
// geometry, scrollTo, and add/removeEventListener for "scroll"/"scrollend".
// Faking this outermost edge is the sanctioned mock (no internal modules mocked).
function createFakeScrollEl(opts?: { scrollHeight?: number; clientHeight?: number }) {
	const listeners = new Map<string, Set<EventListener>>();
	const el = {
		scrollTop: 0,
		scrollHeight: opts?.scrollHeight ?? 1000,
		clientHeight: opts?.clientHeight ?? 100,
		scrollTo: vi.fn((arg: ScrollToOptions) => {
			// Emulate the browser: jump scrollTop, then (for "instant") fire scrollend.
			el.scrollTop = (arg.top ?? 0) - 0;
			if (arg.behavior !== "smooth") {
				fire("scroll");
				fire("scrollend");
			}
		}),
		addEventListener: (type: string, fn: EventListener) => {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)?.add(fn);
		},
		removeEventListener: (type: string, fn: EventListener) => {
			listeners.get(type)?.delete(fn);
		},
	};
	function fire(type: string): void {
		for (const fn of listeners.get(type) ?? []) fn(new Event(type));
	}
	// Simulate the USER scrolling to a given offset (fires scroll, not self-driven).
	function userScrollTo(top: number): void {
		el.scrollTop = top;
		fire("scroll");
	}
	return {
		el: el as unknown as HTMLElement,
		scrollTo: el.scrollTo,
		fire,
		userScrollTo,
		listenerCount: () => listeners,
	};
}

describe("smart-scroll controller", () => {
	it("starts with the button hidden", () => {
		const c = createSmartScrollController();
		expect(c.showButton).toBe(false);
	});

	it("contentChanged while stuck scrolls to the bottom instantly", () => {
		const c = createSmartScrollController();
		const fake = createFakeScrollEl();
		c.attach(fake.el);
		c.contentChanged();
		expect(fake.scrollTo).toHaveBeenCalledWith({
			top: 1000,
			behavior: "instant",
		});
		expect(c.showButton).toBe(false);
	});

	it("a user scroll up shows the button and stops auto-following", () => {
		const c = createSmartScrollController();
		const fake = createFakeScrollEl();
		c.attach(fake.el);
		fake.userScrollTo(200); // far from the bottom
		expect(c.showButton).toBe(true);

		const scrollTo = fake.scrollTo;
		scrollTo.mockClear();
		c.contentChanged(); // streaming more content...
		expect(scrollTo).not.toHaveBeenCalled(); // ...must NOT yank the reader down
		expect(c.showButton).toBe(true);
	});

	it("self-driven scrolls are not misread as the user scrolling up", () => {
		const c = createSmartScrollController();
		const fake = createFakeScrollEl();
		c.attach(fake.el);
		// contentChanged drives an instant scrollTo, whose synthetic scroll event
		// must NOT flip us to unstuck (selfScrolling guard).
		c.contentChanged();
		expect(c.showButton).toBe(false);
	});

	it("resume re-sticks and smooth-scrolls to the bottom", () => {
		const c = createSmartScrollController();
		const fake = createFakeScrollEl();
		c.attach(fake.el);
		fake.userScrollTo(200);
		expect(c.showButton).toBe(true);

		c.resume();
		expect(fake.scrollTo).toHaveBeenCalledWith({
			top: 1000,
			behavior: "smooth",
		});
		expect(c.showButton).toBe(false);
	});

	it("reset snaps to the bottom and hides the button", () => {
		const c = createSmartScrollController();
		const fake = createFakeScrollEl();
		c.attach(fake.el);
		fake.userScrollTo(200);
		expect(c.showButton).toBe(true);
		c.reset();
		expect(fake.scrollTo).toHaveBeenCalledWith({
			top: 1000,
			behavior: "instant",
		});
		expect(c.showButton).toBe(false);
	});

	it("observes content via a ResizeObserver: follows growth while stuck, not while unstuck", () => {
		const holder: { cb: ResizeObserverCallback | null } = { cb: null };
		const observed: unknown[] = [];
		const disconnect = vi.fn();
		class FakeResizeObserver {
			constructor(cb: ResizeObserverCallback) {
				holder.cb = cb;
			}
			observe(target: Element): void {
				observed.push(target);
			}
			unobserve(): void {}
			disconnect = disconnect;
		}
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		try {
			const c = createSmartScrollController();
			const fake = createFakeScrollEl();
			const content = { id: "content" } as unknown as HTMLElement;
			const teardown = c.attach(fake.el, content);

			// Observes both the content (it grows) and the scroll container (viewport resize).
			expect(observed).toContain(content);
			expect(observed).toContain(fake.el);

			// Stuck → a resize keeps us pinned to the bottom.
			fake.scrollTo.mockClear();
			holder.cb?.([], {} as ResizeObserver);
			expect(fake.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "instant" });

			// Reader scrolls up → a later resize must NOT yank them down.
			fake.userScrollTo(200);
			fake.scrollTo.mockClear();
			holder.cb?.([], {} as ResizeObserver);
			expect(fake.scrollTo).not.toHaveBeenCalled();

			// Teardown disconnects the observer.
			teardown();
			expect(disconnect).toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("attach returns a teardown that removes both listeners", () => {
		const c = createSmartScrollController();
		const fake = createFakeScrollEl();
		const teardown = c.attach(fake.el);
		const before = fake.listenerCount();
		expect(before.get("scroll")?.size).toBe(1);
		expect(before.get("scrollend")?.size).toBe(1);
		teardown();
		expect(before.get("scroll")?.size).toBe(0);
		expect(before.get("scrollend")?.size).toBe(0);
	});
});
