<script lang="ts">
	import type { InvokeMessage } from "@dispatch/ui-contract";
	import type { ButtonFieldView } from "../logic/types";

	let {
		field,
		surfaceId,
		onInvoke,
	}: { field: ButtonFieldView; surfaceId: string; onInvoke: (msg: InvokeMessage) => void } =
		$props();

	function handleClick() {
		onInvoke({
			type: "invoke",
			surfaceId,
			actionId: field.action.actionId,
		});
	}
</script>

<button onclick={handleClick}>{field.label}</button>
