<script lang="ts">
	let {
		models,
		selected,
		onSelect,
	}: {
		models: readonly string[];
		selected: string;
		onSelect: (model: string) => void;
	} = $props();
</script>

<select
	class="select"
	value={selected}
	onchange={(e) => onSelect(e.currentTarget.value)}
	aria-label="Model selector"
>
	{#each models as model (model)}
		<option value={model}>{model}</option>
	{/each}
</select>
