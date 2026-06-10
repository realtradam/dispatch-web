<script lang="ts">
	import { type Snippet, untrack } from "svelte";
	import {
		addPanel,
		initialPanels,
		type PanelsState,
		removePanel,
		selectKind,
	} from "../logic/panels";

	interface ViewKind {
		readonly id: string;
		readonly label: string;
	}

	let {
		kinds,
		content,
		initial,
	}: {
		/** The view kinds offered in every panel's dropdown. */
		kinds: readonly ViewKind[];
		/** Renders a panel body for the given (non-null) view-kind id. */
		content: Snippet<[string]>;
		/** Optional seed of panel kinds; defaults to one panel of the first kind. */
		initial?: readonly (string | null)[];
	} = $props();

	// Local UI composition state, owned by this unit and folded through the pure
	// reducer — never reached from elsewhere (no ambient store). Seeded ONCE from
	// the props (untrack makes that one-time read explicit, not reactive).
	let state = $state<PanelsState>(
		untrack(() => initialPanels(initial ?? [kinds[0]?.id ?? null])),
	);
</script>

<div class="flex min-h-0 flex-col gap-2">
	{#each state.panels as panel, idx (panel.id)}
		<div class="flex flex-col rounded-lg bg-base-200 p-3">
			<div class="flex items-center gap-1">
				<select
					class="select select-bordered select-sm flex-1"
					aria-label="Select a view"
					value={panel.kind ?? ""}
					onchange={(e) => {
						const v = e.currentTarget.value;
						state = selectKind(state, panel.id, v === "" ? null : v);
					}}
				>
					<option value="" disabled>Select a view</option>
					{#each kinds as kind (kind.id)}
						<option value={kind.id}>{kind.label}</option>
					{/each}
				</select>
				{#if idx > 0}
					<button
						type="button"
						class="btn btn-square btn-ghost btn-sm shrink-0"
						aria-label="Remove view"
						onclick={() => {
							state = removePanel(state, panel.id);
						}}
					>
						✕
					</button>
				{/if}
			</div>

			{#if panel.kind !== null}
				<div class="mt-2">
					{@render content(panel.kind)}
				</div>
			{/if}
		</div>
	{/each}

	<button
		type="button"
		class="btn w-full border-none bg-base-200 text-lg hover:bg-base-300"
		aria-label="Add view"
		onclick={() => {
			state = addPanel(state);
		}}
	>
		+
	</button>
</div>
