<script lang="ts">
	import Table from "../../../components/Table.svelte";
	import { parseTablePayload } from "../logic/table";

	let { payload }: { readonly payload: unknown } = $props();

	// Parse defensively; an unparseable payload yields null → render nothing
	// (graceful skip, per the custom-field contract).
	const data = $derived(parseTablePayload(payload));
</script>

{#if data !== null}
	<Table columns={data.columns} rows={data.rows} />
{/if}
