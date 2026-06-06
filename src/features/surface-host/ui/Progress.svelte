<script lang="ts">
	import type { ProgressFieldView } from "../logic/types";

	let { field }: { field: ProgressFieldView } = $props();

	const percent = $derived(Math.round(field.value * 100));
</script>

<div>
	<span>{field.label}</span>
	<progress max="100" value={percent}>{percent}%</progress>
	<span>{percent}%</span>
</div>
