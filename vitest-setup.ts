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
// jsdom implements no Element.animate (Web Animations API — svelte transitions
// and the grid's FLIP reflow use it); stub a no-op so components render in tests.
if (typeof Element !== "undefined" && typeof Element.prototype.animate !== "function") {
  Element.prototype.animate = () => {
    const noop = () => {};
    return {
      cancel: noop,
      finish: noop,
      pause: noop,
      play: noop,
      onfinish: null,
    } as unknown as Animation;
  };
}
// jsdom implements no PointerEvent constructor — testing-library's
// fireEvent.pointerDown falls back to a plain Event and drops the pointer
// properties (clientX/pointerType/…). Polyfill over jsdom's MouseEvent (the
// drag/press logic is pointer-driven; a real browser always has PointerEvent).
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "";
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}
