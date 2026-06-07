<script lang="ts">
	import type { Tab } from "../tabs";

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
</script>

<div class="overflow-x-auto border-b border-base-300">
	<div class="tabs tabs-border min-w-max">
		{#each tabs as tab (tab.conversationId)}
			<div
				class="tab"
				class:tab-active={tab.conversationId === activeConversationId}
				role="tab"
				tabindex="0"
				onclick={() => onSelect(tab.conversationId)}
				onkeydown={(e) => {
					if (e.key === "Enter") onSelect(tab.conversationId);
				}}
			>
				<span class="max-w-[120px] truncate">{tab.title}</span>
				<button
					class="btn btn-ghost btn-xs ml-1"
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
			class="tab sticky right-0 z-10 bg-base-200 shadow-[-2px_0_4px_-1px_rgba(0,0,0,0.2)]"
			class:tab-active={activeConversationId === null}
			aria-label="New chat"
			onclick={() => onNewDraft()}
		>
			+
		</button>
	</div>
</div>
