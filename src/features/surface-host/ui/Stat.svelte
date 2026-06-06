<script lang="ts">
	import type { StatFieldView } from "../logic/types";

	let { field }: { field: StatFieldView } = $props();
</script>

<dl>
	<dt>{field.label}</dt>
	<dd>{field.value}</dd>
</dl>
