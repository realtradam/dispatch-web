<script lang="ts">
	import { joinModelName, modelKeys, modelsForKey, splitModelName } from "../model-select";

	let {
		models,
		selected,
		onSelect,
	}: {
		models: readonly string[];
		selected: string;
		onSelect: (model: string) => void;
	} = $props();

	const keys = $derived(modelKeys(models));
	const current = $derived(splitModelName(selected));
	const keyModels = $derived(modelsForKey(models, current.key));

	// Switching key jumps to the first model available under it.
	function selectKey(key: string): void {
		const first = modelsForKey(models, key)[0] ?? "";
		onSelect(joinModelName(key, first));
	}

	function selectModel(model: string): void {
		onSelect(joinModelName(current.key, model));
	}
</script>

<div class="flex flex-col gap-2">
	<select
		class="select w-full"
		value={current.key}
		onchange={(e) => selectKey(e.currentTarget.value)}
		aria-label="Key selector"
	>
		{#each keys as key (key)}
			<option value={key}>{key}</option>
		{/each}
	</select>
	<select
		class="select w-full"
		value={current.model}
		onchange={(e) => selectModel(e.currentTarget.value)}
		aria-label="Model selector"
	>
		{#each keyModels as model (model)}
			<option value={model}>{model}</option>
		{/each}
	</select>
</div>
