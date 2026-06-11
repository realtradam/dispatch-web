import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

// jsdom implements neither Element.scrollTo nor ResizeObserver; the smart-scroll
// controller uses both against the real transcript element when App mounts. Stub
// the outermost edges so component tests can render without throwing.
if (typeof Element !== "undefined" && typeof Element.prototype.scrollTo !== "function") {
	Element.prototype.scrollTo = () => {};
}
if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	};
}
