<script lang="ts">
	import type { InvokeMessage, SurfaceSpec } from "@dispatch/ui-contract";
	import { groupRenderFields, planSurface } from "../logic/plan";
	import Button from "./Button.svelte";
	import Number from "./Number.svelte";
	import Progress from "./Progress.svelte";
	import Selector from "./Selector.svelte";
	import StatTable from "./StatTable.svelte";
	import SurfaceTable from "./SurfaceTable.svelte";
	import Toggle from "./Toggle.svelte";

	let {
		spec,
		onInvoke,
	}: { spec: SurfaceSpec; onInvoke: (msg: InvokeMessage) => void } = $props();

	const plan = $derived(planSurface(spec));
	// Consecutive stats render together as one aligned table; everything else is
	// a standalone widget. Grouping keys on field KIND only — never the surface id.
	const groups = $derived(groupRenderFields(plan.fields));
</script>

<article>
	<h2>{spec.title}</h2>
	{#each groups as group, i (i)}
		{#if group.type === "stats"}
			<StatTable stats={group.stats} />
		{:else if group.field.kind === "toggle"}
			<Toggle field={group.field} surfaceId={spec.id} {onInvoke} />
		{:else if group.field.kind === "progress"}
			<Progress field={group.field} />
		{:else if group.field.kind === "selector"}
			<Selector field={group.field} surfaceId={spec.id} {onInvoke} />
		{:else if group.field.kind === "number"}
			<Number field={group.field} surfaceId={spec.id} {onInvoke} />
		{:else if group.field.kind === "button"}
			<Button field={group.field} surfaceId={spec.id} {onInvoke} />
		{:else if group.field.kind === "custom"}
			<!-- Dispatch on rendererId (a renderer KIND, never a surface id);
			     unknown ids gracefully render nothing. -->
			{#if group.field.rendererId === "table"}
				<SurfaceTable payload={group.field.payload} />
			{/if}
		{/if}
	{/each}
</article>
