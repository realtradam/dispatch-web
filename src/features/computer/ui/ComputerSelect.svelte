<script lang="ts">
	import type { ComputerEntry } from "@dispatch/wire";

	let {
		value,
		computers,
		disabled = false,
		onSelect,
	}: {
		/** The currently selected computer alias, or null for "Local (none)". */
		value: string | null;
		/** Discovered computers from `GET /computers` (read-only). */
		computers: readonly ComputerEntry[];
		disabled?: boolean;
		onSelect: (computerId: string | null) => void;
	} = $props();

	// A `<select>` value is a string; map "" ↔ null (Local). The chosen option's
	// value is the alias, with "" meaning "clear / local".
	const selectValue = $derived(value ?? "");

	function onChange(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value;
		onSelect(v === "" ? null : v);
	}
</script>

<select
	class="select select-bordered select-sm w-full font-mono text-xs"
	value={selectValue}
	disabled={disabled}
	onchange={onChange}
	aria-label="Computer"
>
	<option value="">Local (none)</option>
	{#each computers as c (c.alias)}
		<option value={c.alias}>{c.alias}{c.knownHost ? "" : " · new host"}</option>
	{/each}
</select>
