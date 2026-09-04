// The Svelte API surface exposed to dynamically-imported frontend plugins
// (plan 03): the import map maps the bare `svelte` specifier to this module's
// emitted chunk, whose star re-exports are the SAME module instances the app
// bundles (one rollup graph → one runtime). Entry-module exports are
// preserved in full, so plugins can import bindings the app never uses.
export * from "svelte";
