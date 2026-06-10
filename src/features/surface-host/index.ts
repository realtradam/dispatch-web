export { buildInvoke, planSurface } from "./logic/plan";
export type { FieldView, SurfaceRenderPlan } from "./logic/types";
export { default as SurfaceView } from "./ui/SurfaceView.svelte";

/** Public module manifest — aggregated by the shell's "Loaded Modules" view. */
export const manifest = {
	name: "surface-host",
	description: "Generic renderer for backend-declared surfaces",
} as const;
