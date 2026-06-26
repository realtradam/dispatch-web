/**
 * A Svelte `use:` action that teleports a node to `document.body`, escaping any
 * ancestor that establishes a containing block for `position: fixed` (most
 * commonly an ancestor with a `transform`, `filter`, `perspective`, or
 * `will-change` — e.g. the sidebar's `transform: translateX(...)` container).
 *
 * Without this, a `position: fixed` modal rendered inside such an ancestor is
 * positioned relative to the ANCESTOR, not the viewport (so it only covers the
 * sidebar area instead of the full screen). Moving the node to `document.body`
 * restores viewport-relative `fixed` positioning. Svelte still owns the node's
 * lifecycle (children, bindings, events); we just relocate it + remove it on
 * destroy as hygiene.
 *
 * No-op safely when there is no `document` (SSR / jsdom guards).
 */
export function portal(node: HTMLElement): { destroy(): void } {
  if (typeof document === "undefined") {
    return { destroy() {} };
  }
  document.body.appendChild(node);
  return {
    destroy() {
      if (node.parentNode === document.body) {
        document.body.removeChild(node);
      }
    },
  };
}
