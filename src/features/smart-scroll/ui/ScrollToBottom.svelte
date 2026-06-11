<script lang="ts">
	// Thin affordance: a floating "scroll to bottom" button shown while the reader
	// has scrolled up. Holds no logic — `show` and `onResume` come from the
	// smart-scroll controller.
	let {
		show,
		onResume,
	}: {
		show: boolean;
		onResume: () => void;
	} = $props();
</script>

<button
	type="button"
	class="btn btn-circle btn-sm absolute bottom-4 left-1/2 -translate-x-1/2 shadow-lg transition-opacity duration-200"
	class:opacity-0={!show}
	class:pointer-events-none={!show}
	class:opacity-100={show}
	onclick={onResume}
	aria-label="Scroll to bottom"
	aria-hidden={!show}
	tabindex={show ? 0 : -1}
>
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2.5"
		class="size-4"
		aria-hidden="true"
	>
		<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
	</svg>
</button>
