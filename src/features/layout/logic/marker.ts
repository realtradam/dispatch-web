/**
 * Diagnostic tile-border markers (the contract's additive `TileMarker`
 * presentation field) → the inline outline the renderer draws. Pure
 * decision logic — the .svelte tile components just apply the returned
 * style value.
 *
 * INLINE STYLES, deliberately: a marker value arrives in TREE DATA at
 * runtime, and Tailwind only generates classes it sees in source files — a
 * dynamic class from tree data would silently render nothing. An outline
 * (not a border) is used so the diagnostic draws WITHOUT changing any
 * tile's layout/size (4px solid, clearly visible).
 *
 * The marker is purely presentational: unknown/absent → no outline
 * (existing trees render exactly as before), and no other behavior is
 * attached to it anywhere in the renderer.
 */

import type { TileMarker } from "@dispatch/layout-contract";

/** The diagnostic outline style for a marker — `undefined` = draw nothing. */
export function markerOutline(marker: TileMarker | undefined): string | undefined {
  if (marker === "main") return "4px solid red";
  if (marker === "side") return "4px solid green";
  return undefined;
}
