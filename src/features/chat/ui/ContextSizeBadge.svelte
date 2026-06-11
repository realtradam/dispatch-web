<script lang="ts">
	import { formatContextSize } from "../../../core/metrics";

	let {
		contextSize,
	}: {
		// The conversation's current context size (tokens occupied), or `undefined`
		// ("unknown") when no finalized turn has reported one yet. Never `0` for the
		// unknown case — `formatContextSize` renders a placeholder instead.
		contextSize: number | undefined;
	} = $props();

	const label = $derived(formatContextSize(contextSize));
</script>

<div class="px-4 pb-1 text-xs opacity-60" aria-live="polite">
	<span title="The model's max context window is not reported yet — current usage only.">
		{label}
	</span>
</div>
