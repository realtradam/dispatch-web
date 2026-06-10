<script lang="ts">
	import type { InvokeMessage } from "@dispatch/ui-contract";
	import { ChatView, Composer, ModelSelector } from "../features/chat";
	import { TabBar } from "../features/tabs";
	import { SurfaceView } from "../features/surface-host";
	import type { AppStore } from "./store.svelte";

	let { store }: { store: AppStore } = $props();

	// Right sidebar: open by default on wide screens (pushes the chat aside),
	// closed by default on narrow screens (overlays the chat). Initial state is
	// derived from the viewport width once; the hamburger toggles it thereafter.
	const WIDE_BREAKPOINT = 1024; // Tailwind `lg`
	let sidebarOpen = $state(typeof window !== "undefined" ? window.innerWidth >= WIDE_BREAKPOINT : true);

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

<main class="relative flex h-screen overflow-hidden">
	<!-- LEFT: everything except the sidebar. The full-height sidebar is a sibling
	     (below), so opening it shrinks this ENTIRE column — tab row included, which
	     slides the hamburger left. -->
	<div class="flex min-w-0 flex-1 flex-col overflow-hidden pt-[5px]">
		<!-- Tab row: the tab strip fills + scrolls internally (flex-1 min-w-0), with
		     a permanently seated hamburger pinned to the far right. -->
		<div class="flex min-w-0 items-center">
			<TabBar
				tabs={store.tabs}
				activeConversationId={store.activeConversationId}
				onSelect={(id) => store.selectTab(id)}
				onClose={(id) => store.closeTab(id)}
				onNewDraft={() => store.newDraft()}
			/>
			<button
				class="btn btn-square btn-ghost btn-sm mx-1 shrink-0"
				aria-label="Toggle sidebar"
				aria-expanded={sidebarOpen}
				onclick={() => (sidebarOpen = !sidebarOpen)}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="2"
					stroke="currentColor"
					class="size-5"
					aria-hidden="true"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"
					/>
				</svg>
			</button>
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

		<div class="flex items-center gap-2 px-4 py-2">
			<ModelSelector
				models={store.models}
				selected={store.activeModel}
				onSelect={handleSelectModel}
			/>
		</div>

		<div class="relative min-w-0 flex-1 overflow-y-auto">
			{#key store.activeConversationId}
				<ChatView chunks={store.activeChat.chunks} turnMetrics={store.activeChat.turnMetrics} />
			{/key}
			{#if store.activeChat.chunks.length === 0}
				<div
					class="pointer-events-none absolute inset-0 flex items-center justify-center"
					aria-hidden="true"
				>
					<span class="select-none text-4xl font-bold opacity-10">Dispatch</span>
				</div>
			{/if}
		</div>

		<Composer onSend={handleSend} />

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
	</div>

	<!-- Full-height right sidebar. On wide screens (`lg:relative`) it is in-flow, so
	     opening it shrinks the whole left column (push). Below `lg` it overlays
	     (`max-lg:absolute`, full height) with a backdrop. -->
	<aside
		class="flex shrink-0 flex-col overflow-x-hidden transition-[width] duration-300 ease-out max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 lg:relative"
		class:w-80={sidebarOpen}
		class:w-0={!sidebarOpen}
	>
		<div
			class="flex h-full w-80 flex-col gap-2 overflow-y-auto border-l border-base-300 bg-base-100 p-3 transition-transform duration-300 ease-out"
			style="transform: translateX({sidebarOpen ? '0' : '100%'})"
		>
			<h2 class="text-sm font-semibold opacity-60">Sidebar</h2>
		</div>
	</aside>

	<!-- Backdrop: only on narrow screens (overlay mode), click to close. -->
	{#if sidebarOpen}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-20 bg-black/30 lg:hidden"
			role="button"
			tabindex="0"
			aria-label="Close sidebar"
			onclick={() => (sidebarOpen = false)}
			onkeydown={(e) => {
				if (e.key === "Escape" || e.key === "Enter") sidebarOpen = false;
			}}
		></div>
	{/if}
</main>
