<script lang="ts">
	// Generic, purely presentational table. Props in → markup out; zero logic,
	// zero data-fetching. Shared by the surface custom-field "table" renderer and
	// the frontend "Loaded Modules" view, so neither feature depends on the other.
	let {
		columns,
		rows,
		empty = "No data",
	}: {
		readonly columns: readonly string[];
		readonly rows: readonly (readonly string[])[];
		/** Text shown when there are no rows. */
		readonly empty?: string;
	} = $props();
</script>

<div class="overflow-x-auto">
	<table class="table table-sm">
		<thead>
			<tr>
				{#each columns as col, i (i)}
					<th>{col}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#if rows.length === 0}
				<tr>
					<td colspan={Math.max(columns.length, 1)} class="opacity-60">{empty}</td>
				</tr>
			{:else}
				{#each rows as row, r (r)}
					<tr>
						{#each row as cell, c (c)}
							<td>{cell}</td>
						{/each}
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>
