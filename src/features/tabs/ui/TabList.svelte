<script lang="ts">
	import type { Tab } from "../tabs";
	import { shortHandle } from "../tabs";

	let {
		tabs,
		activeConversationId,
		statusFor,
		onSelect,
		onClose,
		onNewDraft,
		onRename,
	}: {
		tabs: readonly Tab[];
		activeConversationId: string | null;
		/** Returns the conversation's lifecycle status, or undefined when unknown. */
		statusFor?: (conversationId: string) => string | undefined;
		onSelect: (conversationId: string) => void;
		onClose: (conversationId: string) => void;
		onNewDraft: () => void;
		onRename?: (conversationId: string, title: string) => void;
	} = $props();

	// Git-style short handle (shortest unique prefix) per open tab — the visible
	// "tab ID". Derived from the set of open conversation ids; pure helper.
	const handles = $derived.by(() => {
		const ids = tabs.map((t) => t.conversationId);
		const map = new Map<string, string>();
		for (const id of ids) map.set(id, shortHandle(id, ids));
		return map;
	});

	// Inline rename: double-click a tab's title to edit, Enter/blur to save.
	let editingId = $state<string | null>(null);
	let editValue = $state("");
	let editEl = $state<HTMLInputElement>();

	function startRename(tab: Tab): void {
		if (onRename === undefined) return;
		editingId = tab.conversationId;
		editValue = tab.title;
		// Focus the input after it renders.
		queueMicrotask(() => editEl?.focus());
	}

	function commitRename(): void {
		const id = editingId;
		if (id !== null && onRename !== undefined) {
			const trimmed = editValue.trim();
			if (trimmed.length > 0) onRename(id, trimmed);
		}
		editingId = null;
	}

	function cancelRename(): void {
		editingId = null;
	}

	// Click-to-copy the agent (conversation) id: clicking the ID badge copies the
	// FULL conversationId to the clipboard (the stable, useful id — the badge
	// only shows a short prefix) and highlights the badge text as feedback. The
	// highlight (text selection) is the indicator — no text is swapped, so the
	// badge keeps a stable width. If the clipboard write fails, the selection is
	// already in place so the user can Ctrl+C the text manually.
	async function copyId(conversationId: string, el: HTMLElement): Promise<void> {
		selectText(el);
		const clipboard = navigator.clipboard;
		if (clipboard === undefined) return;
		try {
			await clipboard.writeText(conversationId);
		} catch {
			// Selection already lets the user copy manually.
		}
	}

	function selectText(el: HTMLElement): void {
		const range = document.createRange();
		range.selectNodeContents(el);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}
</script>

<div class="flex flex-col gap-2">
	<!-- Single-column vertical tab list. Fixed at 60% of the viewport height so a
	     long tab set scrolls inside this region instead of growing the whole sidebar. -->
	<div class="flex h-[60vh] flex-col gap-1 overflow-y-auto pr-1">
		{#each tabs as tab (tab.conversationId)}
			<div
				class="flex items-center gap-1.5 rounded px-2 py-1.5 text-sm hover:bg-base-300"
				class:bg-base-300={tab.conversationId === activeConversationId}
				role="tab"
				tabindex="0"
				aria-selected={tab.conversationId === activeConversationId}
				title={tab.title}
				onclick={() => onSelect(tab.conversationId)}
				onkeydown={(e) => {
					if (e.key === "Enter") onSelect(tab.conversationId);
				}}
			>
				<button
					type="button"
					class="shrink-0 rounded bg-base-300 px-1 py-0.5 font-mono text-[10px] leading-none text-base-content/60 transition-colors hover:bg-primary hover:text-primary-content"
					data-copy-id={tab.conversationId}
					title="Click to copy conversation id"
					aria-label={`Copy conversation id ${tab.conversationId}`}
					onclick={(e) => {
						e.stopPropagation();
						void copyId(tab.conversationId, e.currentTarget);
					}}
				>
					{handles.get(tab.conversationId) ?? tab.conversationId}
				</button>
				{#if editingId === tab.conversationId}
					<input
						bind:this={editEl}
						bind:value={editValue}
						class="min-w-0 flex-1 rounded bg-base-100 px-1 py-0.5 text-left text-sm outline outline-1 outline-primary"
						onclick={(e) => e.stopPropagation()}
						onkeydown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								commitRename();
							} else if (e.key === "Escape") {
								e.preventDefault();
								cancelRename();
							}
						}}
						onblur={commitRename}
					/>
				{:else}
					<span
						class="min-w-0 flex-1 cursor-pointer truncate text-left"
						role="button"
						tabindex="-1"
						title={tab.title}
						ondblclick={(e) => {
							e.stopPropagation();
							startRename(tab);
						}}
					>
						{tab.title}
					</span>
				{/if}
				{#if statusFor?.(tab.conversationId) === "queued"}
					<!-- Waiting for a concurrency slot — a ring (vs the dots of `active`). -->
					<span
						class="loading loading-ring loading-xs shrink-0 text-primary"
						aria-label="Queued"
						title="Waiting for a concurrency slot"
					></span>
				{:else if statusFor?.(tab.conversationId) === "active"}
					<span class="loading loading-dots loading-xs shrink-0 text-primary"></span>
				{/if}
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
	</div>

	<button
		type="button"
		class="btn btn-ghost btn-sm w-full border border-base-300"
		class:btn-primary={activeConversationId === null}
		aria-label="New chat"
		onclick={() => onNewDraft()}
	>
		{#if activeConversationId === null}
			New Chat
		{:else}
			+ New chat
		{/if}
	</button>
</div>
