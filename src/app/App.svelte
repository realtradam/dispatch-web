<script lang="ts">
	import type { InvokeMessage } from "@dispatch/ui-contract";
	import Table from "../components/Table.svelte";
	import {
		CacheWarmingView,
		manifest as cacheWarmingManifest,
		type WarmFeedback,
	} from "../features/cache-warming";
	import {
		ChatView,
		Composer,
		manifest as chatManifest,
		ContextSizeBadge,
		ModelSelector,
	} from "../features/chat";
	import { manifest as conversationCacheManifest } from "../features/conversation-cache";
	import { manifest as markdownManifest } from "../features/markdown";
	import {
		createSmartScrollController,
		manifest as smartScrollManifest,
		ScrollToBottom,
	} from "../features/smart-scroll";
	import { manifest as surfaceHostManifest, SurfaceView } from "../features/surface-host";
	import { manifest as tabsManifest, TabBar } from "../features/tabs";
	import { manifest as viewsManifest, ViewSidebar } from "../features/views";
	import {
		CwdField,
		type CwdSaveResult,
		LspStatusView,
		type LspStatusResult,
		manifest as workspaceManifest,
	} from "../features/workspace";
	import type { AppStore } from "./store.svelte";

	let { store }: { store: AppStore } = $props();

	// The backend's conversation-scoped cache-warming surface. Referenced by id at
	// the composition root (sanctioned discovery-by-id) to give it a dedicated view
	// and keep it out of the generic Extensions surface list — SurfaceView itself
	// stays fully generic (it never switches on a surface id).
	const CACHE_WARMING_ID = "cache-warming";

	// The view kinds offered in the sidebar's dropdown. Generic data — the
	// `viewContent` snippet below maps each kind id to its renderer.
	const viewKinds = [
		{ id: "model", label: "Model" },
		{ id: "lsp", label: "Language Servers" },
		{ id: "extensions", label: "Extensions" },
		{ id: "cache-warming", label: "Cache Warming" },
	] as const;

	// Default sidebar layout: Model panel on top, then Language Servers, Extensions, Cache Warming.
	const initialViews = ["model", "lsp", "extensions", "cache-warming"] as const;

	// Frontend module list for the "Loaded Modules" view, AGGREGATED from each
	// feature's public `manifest` export so it can't drift from what's actually
	// composed. (The backend's "Loaded Extensions" surface is a SEPARATE,
	// backend-owned list.) FE features are internal units of this single repo, so
	// there is no per-module version — they all share dispatch-web's version.
	const MODULE_COLUMNS = ["Module", "Description"] as const;
	const loadedModules: readonly (readonly [string, string])[] = [
		chatManifest,
		tabsManifest,
		surfaceHostManifest,
		viewsManifest,
		conversationCacheManifest,
		markdownManifest,
		cacheWarmingManifest,
		workspaceManifest,
		smartScrollManifest,
	].map((m) => [m.name, m.description] as const);

	// Smart-scroll: keep the transcript pinned to the bottom while it streams,
	// unless the reader has scrolled up (then show a "scroll to bottom" button).
	// One controller owns the chat scroll region; effects below feed it the edges.
	const smartScroll = createSmartScrollController();
	let transcriptEl = $state<HTMLElement | undefined>();
	let transcriptContentEl = $state<HTMLElement | undefined>();

	// Attach/detach the controller to the live scroll element + content (disposed on
	// unmount). The content element is observed (ResizeObserver) so the view follows
	// height changes that aren't a transcript append.
	$effect(() => {
		if (!transcriptEl) return;
		return smartScroll.attach(transcriptEl, transcriptContentEl);
	});

	// New transcript content streamed in (or messages loaded) → follow the bottom
	// while stuck. Reads `chunks.length` so the effect re-runs on every append.
	$effect(() => {
		void store.activeChat.chunks.length;
		smartScroll.contentChanged();
	});

	// Conversation/tab switch → snap to the bottom of the new transcript.
	$effect(() => {
		void store.activeConversationId;
		smartScroll.reset();
	});

	// Right sidebar: open by default on wide screens (pushes the chat aside),
	// closed by default on narrow screens (overlays the chat). Initial state is
	// derived from the viewport width once; the hamburger toggles it thereafter.
	const WIDE_BREAKPOINT = 1024; // Tailwind `lg`
	let sidebarOpen = $state(typeof window !== "undefined" ? window.innerWidth >= WIDE_BREAKPOINT : true);

	function handleInvoke(msg: InvokeMessage) {
		store.invoke(msg.surfaceId, msg.actionId, msg.payload);
	}

	function handleSend(text: string) {
		store.send(text);
	}

	function handleSelectModel(model: string) {
		store.selectModel(model);
	}

	// Adapt the store's WarmResult to the cache-warming feature's WarmNow port.
	async function warmNow(): Promise<WarmFeedback | null> {
		const result = await store.warmNow();
		if (result === null) return null;
		return result.ok
			? {
					ok: true,
					cachePct: result.response.cachePct,
					expectedCacheRate: result.response.expectedCacheRate,
				}
			: { ok: false, error: result.error };
	}

	// Adapt the store's cwd/LSP results to the workspace feature's ports.
	async function saveCwd(cwd: string): Promise<CwdSaveResult | null> {
		const result = await store.setCwd(cwd);
		if (result === null) return null;
		return result.ok ? { ok: true, cwd: result.cwd } : { ok: false, error: result.error };
	}

	async function loadLspStatus(): Promise<LspStatusResult | null> {
		const result = await store.lspStatus();
		if (result === null) return null;
		return result.ok
			? { ok: true, cwd: result.response.cwd, servers: result.response.servers }
			: { ok: false, error: result.error };
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

		<div class="relative min-h-0 min-w-0 flex-1">
			<div bind:this={transcriptEl} class="h-full overflow-y-auto">
				<div bind:this={transcriptContentEl}>
					{#key store.activeConversationId}
						<ChatView chunks={store.activeChat.chunks} turnMetrics={store.activeChat.turnMetrics} />
					{/key}
				</div>
			</div>
			{#if store.activeChat.chunks.length === 0}
				<div
					class="pointer-events-none absolute inset-0 flex items-center justify-center"
					aria-hidden="true"
				>
					<span class="select-none text-4xl font-bold opacity-10">Dispatch</span>
				</div>
			{/if}
			<ScrollToBottom show={smartScroll.showButton} onResume={() => smartScroll.resume()} />
		</div>

		<ContextSizeBadge contextSize={store.activeChat.currentContextSize} />
		<Composer onSend={handleSend} />
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
			<ViewSidebar kinds={viewKinds} initial={initialViews} content={viewContent} />
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

{#snippet viewContent(kind: string)}
	{#if kind === "model"}
		<div class="flex flex-col gap-3">
			<ModelSelector models={store.models} selected={store.activeModel} onSelect={handleSelectModel} />
			<!-- Keyed on the workspace conversation (active tab OR draft) so the input
			     re-mounts per conversation — incl. switching between drafts — and can't
			     bleed across tabs. Editable for a draft too (cwd applies from turn 1). -->
			{#key store.currentConversationId}
				<CwdField cwd={store.cwd} canEdit={true} save={saveCwd} />
			{/key}
		</div>
	{:else if kind === "lsp"}
		<!-- Re-mount per conversation (incl. draft) so the loaded server list is isolated. -->
		{#key store.currentConversationId}
			<LspStatusView cwd={store.cwd} canView={true} load={loadLspStatus} />
		{/key}
	{:else if kind === "extensions"}
		<section>
			<h3 class="mb-1 text-xs font-semibold uppercase opacity-60">Frontend modules</h3>
			<Table columns={MODULE_COLUMNS} rows={loadedModules} />
		</section>
		<section class="mt-4 flex flex-col gap-3">
			<h3 class="text-xs font-semibold uppercase opacity-60">Surfaces</h3>
			{#each store.surfaces.filter((s) => s.id !== CACHE_WARMING_ID) as spec (spec.id)}
				<SurfaceView {spec} onInvoke={handleInvoke} />
			{/each}
		</section>
	{:else if kind === "cache-warming"}
		<!-- Re-mount per conversation (like ChatView) so the view's local warming
		     history / manual-warm feedback can't bleed across tabs. -->
		{#key store.activeConversationId}
			<CacheWarmingView
				spec={store.surface(CACHE_WARMING_ID)}
				canWarm={store.activeConversationId !== null}
				onInvoke={handleInvoke}
				{warmNow}
			/>
		{/key}
	{/if}
{/snippet}
