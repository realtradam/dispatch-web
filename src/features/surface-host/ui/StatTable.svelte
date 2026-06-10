<script lang="ts">
	import type { StatFieldView } from "../logic/types";

	// Renders a run of stat fields as one aligned label/value table. Headerless:
	// the column semantics aren't known generically, but the two-column layout
	// gives the tidy, aligned readout the stats deserve (e.g. extension → version).
	let { stats }: { readonly stats: readonly StatFieldView[] } = $props();
</script>

<div class="overflow-x-auto">
	<table class="table table-sm">
		<tbody>
			{#each stats as stat, i (i)}
				<tr>
					<th class="font-medium">{stat.label}</th>
					<td class="text-right tabular-nums">{stat.value}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
