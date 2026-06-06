<script lang="ts">
	import type { InvokeMessage } from "@dispatch/ui-contract";
	import type { SelectorFieldView } from "../logic/types";

	let {
		field,
		surfaceId,
		onInvoke,
	}: { field: SelectorFieldView; surfaceId: string; onInvoke: (msg: InvokeMessage) => void } =
		$props();

	function handleChange(event: Event) {
		const target = event.target as HTMLSelectElement;
		onInvoke({
			type: "invoke",
			surfaceId,
			actionId: field.action.actionId,
			payload: target.value,
		});
	}
</script>

<label>
	{field.label}
	<select onchange={handleChange}>
		{#each field.options as option (option.value)}
			<option value={option.value} selected={option.value === field.value}>
				{option.label}
			</option>
		{/each}
	</select>
</label>
