<script lang="ts">
	import type { InvokeMessage } from "@dispatch/ui-contract";
	import type { ToggleFieldView } from "../logic/types";

	let {
		field,
		surfaceId,
		onInvoke,
	}: { field: ToggleFieldView; surfaceId: string; onInvoke: (msg: InvokeMessage) => void } =
		$props();

	function handleChange() {
		onInvoke({
			type: "invoke",
			surfaceId,
			actionId: field.action.actionId,
			payload: !field.value,
		});
	}
</script>

<label>
	<input type="checkbox" checked={field.value} onchange={handleChange} />
	{field.label}
</label>
