// The compiled-runes runtime exposed to dynamically-imported frontend
// plugins (plan 03): the import map maps the bare `svelte/internal/client`
// specifier to this module's emitted chunk — the same runtime instance the
// app's own compiled components use.
//
// `svelte/internal/client` is intentionally untyped (the compiled-runes
// runtime — its API is compiler-private), so the re-export needs the
// suppression below. Nothing in the app imports THROUGH this module — the
// import map hands it to plugins; its entry exports are preserved in full.
//
// @ts-expect-error — svelte/internal/client ships no declaration file
export * from "svelte/internal/client";
