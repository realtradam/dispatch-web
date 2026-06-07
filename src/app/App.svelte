<script lang="ts">
	import type { InvokeMessage } from "@dispatch/ui-contract";
	import { ChatView, Composer, ModelSelector, TurnSummary } from "../features/chat";
	import { TabBar } from "../features/tabs";
	import { SurfaceView } from "../features/surface-host";
	import type { AppStore } from "./store.svelte";

	let { store }: { store: AppStore } = $props();

	function handleSelect(surfaceId: string) {
		store.select(surfaceId);
	}

	function handleInvoke(msg: InvokeMessage) {
		store.invoke(msg.surfaceId, msg.actionId, msg.payload);
	}

	function handleSend(text: string) {
		store.send(text);
	}

	function handleSelectModel(model: string) {
		store.selectModel(model);
	}
</script>

<main class="flex h-screen flex-col">
	<div class="flex items-center justify-between border-b border-base-300 px-4 py-2">
		<h1 class="text-lg font-bold">Dispatch</h1>
	</div>

	{#if store.lastError}
		<div role="alert" class="alert alert-error mx-4 mt-2">
			<strong>Error:</strong>
			{store.lastError.message}
		</div>
	{/if}

	{#if store.activeChat.error}
		<div role="alert" class="alert alert-warning mx-4 mt-2">
			<strong>Chat error:</strong>
			{store.activeChat.error}
		</div>
	{/if}

	<TabBar
		tabs={store.tabs}
		activeConversationId={store.activeConversationId}
		onSelect={(id) => store.selectTab(id)}
		onClose={(id) => store.closeTab(id)}
		onNewDraft={() => store.newDraft()}
	/>

	<div class="flex flex-1 flex-col overflow-hidden">
		<div class="flex items-center gap-2 px-4 py-2">
			<ModelSelector
				models={store.models}
				selected={store.activeModel}
				onSelect={handleSelectModel}
			/>
		</div>

		<div class="flex-1 overflow-y-auto">
			{#key store.activeConversationId}
				<ChatView
					chunks={store.activeChat.chunks}
					telemetry={store.activeChat.telemetry}
					currentTurnId={store.activeChat.currentTurnId}
				/>
				<TurnSummary
					telemetry={store.activeChat.telemetry}
					turnId={store.activeChat.currentTurnId}
				/>
			{/key}
		</div>

		<Composer onSend={handleSend} />
	</div>

	{#if store.catalog.length > 0}
		<section class="border-t border-base-300 p-4">
			<h2 class="mb-2 text-sm font-semibold">Surfaces</h2>
			<div class="flex flex-wrap gap-2">
				{#each store.catalog as entry (entry.id)}
					<button
						class="btn btn-sm"
						class:btn-active={entry.id === store.selectedId}
						aria-current={entry.id === store.selectedId ? "true" : undefined}
						onclick={() => handleSelect(entry.id)}
					>
						{entry.title}
						<span class="text-xs opacity-60">({entry.region})</span>
					</button>
				{/each}
			</div>
		</section>
	{/if}

	{#if store.selectedSpec}
		<section class="border-t border-base-300 p-4">
			<SurfaceView spec={store.selectedSpec} onInvoke={handleInvoke} />
		</section>
	{/if}
</main>
