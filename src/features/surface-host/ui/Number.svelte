<script lang="ts">
	import type { InvokeMessage } from "@dispatch/ui-contract";
	import type { NumberFieldView } from "../logic/types";

	let {
		field,
		surfaceId,
		onInvoke,
	}: { field: NumberFieldView; surfaceId: string; onInvoke: (msg: InvokeMessage) => void } =
		$props();

	// Commit on change/Enter rather than every keystroke. Ignore empty/non-numeric
	// input (the backend also floors/validates); send the new number as payload.
	function commit(event: Event) {
		const target = event.target as HTMLInputElement;
		const next = target.valueAsNumber;
		if (Number.isNaN(next)) return;
		onInvoke({
			type: "invoke",
			surfaceId,
			actionId: field.action.actionId,
			payload: next,
		});
	}
</script>

<label class="flex items-center justify-between gap-2 text-sm">
	<span>{field.label}</span>
	<span class="flex items-center gap-1">
		<input
			type="number"
			class="input input-bordered input-sm w-24"
			value={field.value}
			min={field.min}
			max={field.max}
			step={field.step}
			onchange={commit}
		/>
		{#if field.unit}
			<span class="opacity-60">{field.unit}</span>
		{/if}
	</span>
</label>
