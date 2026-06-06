<script lang="ts">
	import type { InvokeMessage, SurfaceSpec } from "@dispatch/ui-contract";
	import { planSurface } from "../logic/plan";
	import Button from "./Button.svelte";
	import Progress from "./Progress.svelte";
	import Selector from "./Selector.svelte";
	import Stat from "./Stat.svelte";
	import Toggle from "./Toggle.svelte";

	let {
		spec,
		onInvoke,
	}: { spec: SurfaceSpec; onInvoke: (msg: InvokeMessage) => void } = $props();

	const plan = $derived(planSurface(spec));
</script>

<article>
	<h2>{spec.title}</h2>
	{#each plan.fields as field (field)}
		{#if field.kind === "toggle"}
			<Toggle {field} surfaceId={spec.id} {onInvoke} />
		{:else if field.kind === "progress"}
			<Progress {field} />
		{:else if field.kind === "selector"}
			<Selector {field} surfaceId={spec.id} {onInvoke} />
		{:else if field.kind === "stat"}
			<Stat {field} />
		{:else if field.kind === "button"}
			<Button {field} surfaceId={spec.id} {onInvoke} />
		{/if}
	{/each}
</article>
