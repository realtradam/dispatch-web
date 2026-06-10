<script lang="ts">
	import type { Tab } from "../tabs";
	import { isStuckToEnd, shortHandle } from "../tabs";

	let {
		tabs,
		activeConversationId,
		onSelect,
		onClose,
		onNewDraft,
	}: {
		tabs: readonly Tab[];
		activeConversationId: string | null;
		onSelect: (conversationId: string) => void;
		onClose: (conversationId: string) => void;
		onNewDraft: () => void;
	} = $props();

	// The new-chat button is `position: sticky; right: 0`. It floats over the tabs
	// only while the strip overflows and isn't scrolled fully right; we square its
	// right edge only in that "stuck" state. Pure decision (`isStuckToEnd`) +
	// DOM-measurement at the edge here.
	let scrollEl = $state<HTMLDivElement>();
	let stuck = $state(false);

	// Git-style short handle (shortest unique prefix) per open tab — the visible
	// "tab ID". Derived from the set of open conversation ids; pure helper.
	const handles = $derived.by(() => {
		const ids = tabs.map((t) => t.conversationId);
		const map = new Map<string, string>();
		for (const id of ids) map.set(id, shortHandle(id, ids));
		return map;
	});

	function recompute(): void {
		const el = scrollEl;
		if (el === undefined) {
			stuck = false;
			return;
		}
		stuck = isStuckToEnd({
			scrollLeft: el.scrollLeft,
			clientWidth: el.clientWidth,
			scrollWidth: el.scrollWidth,
		});
	}

	$effect(() => {
		const el = scrollEl;
		if (el === undefined) return;
		// Re-evaluate when the tab set changes (overflow may appear/disappear).
		void tabs;
		recompute();

		el.addEventListener("scroll", recompute, { passive: true });
		const ro =
			typeof ResizeObserver !== "undefined" ? new ResizeObserver(recompute) : undefined;
		ro?.observe(el);

		return () => {
			el.removeEventListener("scroll", recompute);
			ro?.disconnect();
		};
	});
</script>

<div bind:this={scrollEl} class="min-w-0 flex-1 overflow-x-auto">
	<div class="tabs tabs-lift min-w-max">
		{#each tabs as tab (tab.conversationId)}
			<div
				class="tab flex w-48 shrink-0 items-center gap-1.5"
				class:tab-active={tab.conversationId === activeConversationId}
				role="tab"
				tabindex="0"
				onclick={() => onSelect(tab.conversationId)}
				onkeydown={(e) => {
					if (e.key === "Enter") onSelect(tab.conversationId);
				}}
			>
				<span
					class="shrink-0 rounded bg-base-300 px-1 py-0.5 font-mono text-[10px] leading-none text-base-content/60"
					title="Tab ID"
				>
					{handles.get(tab.conversationId) ?? tab.conversationId}
				</span>
				<span class="min-w-0 flex-1 truncate text-left">{tab.title}</span>
				<button
					class="btn btn-ghost btn-xs shrink-0"
					aria-label="Close tab"
					onclick={(e) => {
						e.stopPropagation();
						onClose(tab.conversationId);
					}}
				>
					&times;
				</button>
			</div>
		{/each}
		<button
			class="tab sticky right-0 z-10 bg-base-200 shadow-[-2px_0_4px_-1px_rgba(0,0,0,0.2)] {stuck
				? '!rounded-se-none !rounded-ee-none'
				: ''}"
			class:tab-active={activeConversationId === null}
			aria-label="New chat"
			onclick={() => onNewDraft()}
		>
			{#if activeConversationId === null}
				<span class="max-w-[120px] truncate">New Chat</span>
				<span class="btn btn-ghost btn-xs ml-1" aria-hidden="true">+</span>
			{:else}
				+
			{/if}
		</button>
	</div>
</div>
