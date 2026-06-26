<script lang="ts">
	import type { ImageInput, ReasoningEffort } from "@dispatch/transport-contract";
	import type { InvokeMessage } from "@dispatch/ui-contract";
	import { tick } from "svelte";
	import Table from "../components/Table.svelte";
	import {
		CacheWarmingView,
		manifest as cacheWarmingManifest,
		type WarmFeedback,
	} from "../features/cache-warming";
	import {
		ChatView,
		CompactionView,
		Composer,
		manifest as chatManifest,
		ModelSelector,
		ReasoningEffortSelector,
		type CompactNowResult,
		type ReasoningEffortSaveResult,
		type SaveCompactPercentResult,
	} from "../features/chat";
	import { manifest as conversationCacheManifest } from "../features/conversation-cache";
	import { manifest as markdownManifest } from "../features/markdown";
	import {
		McpStatusView,
		manifest as mcpManifest,
		type McpStatusResult,
	} from "../features/mcp";
	import {
		ChatLimitField,
		manifest as settingsManifest,
		type ChatLimitSaveResult,
	} from "../features/settings";
	import {
		createSmartScrollController,
		manifest as smartScrollManifest,
		ScrollToBottom,
	} from "../features/smart-scroll";
	import { manifest as surfaceHostManifest, SurfaceView } from "../features/surface-host";
	import { parseMessageQueuePayload } from "../features/surface-host/logic/message-queue";
	import { parseTodoPayload } from "../features/surface-host/logic/todo";
	import TodoList from "../features/surface-host/ui/TodoList.svelte";
	import { manifest as tabsManifest, TabBar } from "../features/tabs";
	import { manifest as viewsManifest, ViewSidebar } from "../features/views";
	import {
		CwdField,
		type CwdSaveResult,
		LspStatusView,
		type LspStatusResult,
		manifest as cwdLspManifest,
	} from "../features/cwd-lsp";
	import {
		ComputerField,
		manifest as computerManifest,
		type ComputerSaveResult,
		type ComputerStatusResult,
		type LoadComputerStatus,
		type SaveComputer,
		type TestComputer,
		type TestComputerResult,
	} from "../features/computer";
	import {
		HeartbeatView,
		manifest as heartbeatManifest,
		RunModal,
		type HeartbeatConfigResult,
		type HeartbeatNextRunResult,
		type HeartbeatRunView,
		type HeartbeatRunsResult,
		type HeartbeatStopResult,
	} from "../features/heartbeat";
	import type { ChatStore } from "../features/chat";
	import {
		SystemPromptBuilder,
		type LoadSystemPrompt as LoadSystemPromptAlias,
		type LoadSystemPromptVariables as LoadSystemPromptVariablesAlias,
		type SaveSystemPrompt as SaveSystemPromptAlias,
		manifest as systemPromptManifest,
	} from "../features/system-prompt";
	import type { AppStore } from "./store.svelte";
	import ErrorModal from "./ErrorModal.svelte";
	import { createLocalStore } from "../adapters/local-storage";
	import { untrack } from "svelte";

	let { store }: { store: AppStore } = $props();

	// The backend's conversation-scoped cache-warming surface. Referenced by id at
	// the composition root (sanctioned discovery-by-id) to give it a dedicated view
	// and keep it out of the generic Extensions surface list — SurfaceView itself
	// stays fully generic (it never switches on a surface id).
	const CACHE_WARMING_ID = "cache-warming";
	// The message-queue extension's per-conversation surface (steering). Pulled
	// out of the generic Extensions list and rendered as a compact panel above the
	// composer — pending steering messages are tied to the chat, not the sidebar.
	const MESSAGE_QUEUE_ID = "message-queue";
	// The `todo` extension's per-conversation task list surface (model-maintained).
	const TODO_ID = "todo";

	// The view kinds offered in the sidebar's dropdown. Generic data — the
	// `viewContent` snippet below maps each kind id to its renderer.
	const viewKinds = [
		{ id: "model", label: "Model" },
		{ id: "lsp", label: "Language Servers" },
		{ id: "mcp", label: "MCP Servers" },
		{ id: "extensions", label: "Extensions" },
		{ id: "cache-warming", label: "Cache Warming" },
		{ id: "tasks", label: "Tasks" },
		{ id: "compaction", label: "Compaction" },
		{ id: "heartbeat", label: "Heartbeat" },
		{ id: "system-prompt", label: "System Prompt" },
		{ id: "settings", label: "Settings" },
	] as const;

	// Default sidebar layout: just the Model view.
	const DEFAULT_VIEWS: readonly string[] = ["model"];
	const sidebarStore = createLocalStore<readonly string[]>("dispatch.sidebar.views", {
		storage: untrack(() => store.storage),
	});
	const sidebarPanels = sidebarStore.load() ?? DEFAULT_VIEWS;

	function handleSidebarChange(kinds: readonly (string | null)[]): void {
		sidebarStore.save(kinds.filter((k): k is string => k !== null));
	}

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
		cwdLspManifest,
		mcpManifest,
		computerManifest,
		smartScrollManifest,
		settingsManifest,
		systemPromptManifest,
		heartbeatManifest,
	].map((m) => [m.name, m.description] as const);

	// Smart-scroll: keep the transcript pinned to the bottom while it streams,
	// unless the reader has scrolled up (then show a "scroll to bottom" button).
	// One controller owns the chat scroll region; effects below feed it the edges.
	const smartScroll = createSmartScrollController();
	let transcriptEl = $state<HTMLElement | undefined>();
	let transcriptContentEl = $state<HTMLElement | undefined>();

	// Chat-limit unload gate: old chunks may be unloaded only while the reader is
	// stuck to the bottom. While stuck, a trim removes content far ABOVE the
	// viewport and the controller re-pins to the bottom — no visible jump; while
	// reading history, trimming is deferred instead of yanking the page (the old
	// Dispatch bug). In an $effect so a swapped store prop would be re-wired.
	$effect(() => {
		store.attachUnloadGate(() => smartScroll.isAtBottom());
	});

	// "Show earlier messages": page older history back in, preserving the reader's
	// viewport position — prepended content grows scrollHeight, so shift scrollTop
	// by the growth (the manual analogue of CSS scroll anchoring, which not every
	// engine applies here).
	async function handleShowEarlier(): Promise<void> {
		const el = transcriptEl;
		const prevHeight = el?.scrollHeight ?? 0;
		const prevTop = el?.scrollTop ?? 0;
		await store.activeChat.showEarlier();
		await tick();
		if (el) {
			const delta = el.scrollHeight - prevHeight;
			if (delta > 0) el.scrollTop = prevTop + delta;
		}
	}

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

	// The message-queue surface spec + whether it currently has pending messages
	// (steering). Rendered as a compact panel above the composer only when non-empty.
	const messageQueueSpec = $derived(store.surface(MESSAGE_QUEUE_ID));
	const hasQueuedMessages = $derived.by(() => {
		const spec = messageQueueSpec;
		if (spec === null) return false;
		const field = spec.fields.find((f) => f.kind === "custom" && f.rendererId === MESSAGE_QUEUE_ID);
		if (field === undefined || field.kind !== "custom") return false;
		const data = parseMessageQueuePayload(field.payload);
		return data !== null && data.messages.length > 0;
	});

	// The todo surface spec + its parsed task list (model-maintained, read-only).
	const todoSpec = $derived(store.surface(TODO_ID));
	const todoData = $derived.by(() => {
		const spec = todoSpec;
		if (spec === null) return null;
		const field = spec.fields.find((f) => f.kind === "custom" && f.rendererId === TODO_ID);
		if (field === undefined || field.kind !== "custom") return null;
		return parseTodoPayload(field.payload);
	});

	// Conversation/tab switch → snap to the bottom of the new transcript.
	$effect(() => {
		void store.activeConversationId;
		smartScroll.reset();
	});

	// Right sidebar: persisted open/closed state. Defaults to open on wide
	// screens (first visit), then remembers the user's toggle thereafter.
	const WIDE_BREAKPOINT = 1024; // Tailwind `lg`
	const sidebarOpenStore = createLocalStore<boolean>("dispatch.sidebar.open", {
		storage: untrack(() => store.storage),
	});
	const storedSidebarOpen = sidebarOpenStore.load();
	let sidebarOpen = $state(storedSidebarOpen ?? (typeof window !== "undefined" ? window.innerWidth >= WIDE_BREAKPOINT : true));
	let systemPromptModalOpen = $state(false);
	// The heartbeat run currently open in the fullscreen run-chat modal (null =
	// closed). Holds a snapshot run view; the modal re-mounts per run (keyed).
	let heartbeatRun = $state<HeartbeatRunView | null>(null);

	$effect(() => {
		sidebarOpenStore.save(sidebarOpen);
	});

	function handleInvoke(msg: InvokeMessage) {
		store.invoke(msg.surfaceId, msg.actionId, msg.payload);
	}

	function handleSend(text: string, images?: readonly ImageInput[]): void {
		store.send(text, images);
	}

	function handleQueue(text: string) {
		store.queueMessage(text);
	}

	function handleStop() {
		store.stopGeneration();
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

	// Adapt the store's reasoning-effort result to the chat feature's port.
	async function saveReasoningEffort(
		level: ReasoningEffort,
	): Promise<ReasoningEffortSaveResult | null> {
		const result = await store.setReasoningEffort(level);
		if (result === null) return null;
		return result.ok
			? { ok: true, reasoningEffort: result.reasoningEffort }
			: { ok: false, error: result.error };
	}

	// Adapt the store's compact result to the compaction view's port.
	async function compactNow(): Promise<CompactNowResult | null> {
		const result = await store.compactNow();
		if (result === null) return null;
		return result.ok
			? {
					ok: true,
					messagesSummarized: result.response.messagesSummarized,
					messagesKept: result.response.messagesKept,
				}
			: { ok: false, error: result.error };
	}

	async function saveCompactPercent(
		percent: number,
	): Promise<SaveCompactPercentResult | null> {
		const result = await store.setCompactPercent(percent);
		if (result === null) return null;
		return result.ok
			? { ok: true, percent: result.percent }
			: { ok: false, error: result.error };
	}

	// Adapt the store's chat-limit result to the settings feature's port. On a
	// raise the active chat refills (prepends older history); preserve the
	// reader's viewport over the prepend (the manual analogue of CSS scroll
	// anchoring), exactly like `handleShowEarlier`.
	async function saveChatLimit(value: number): Promise<ChatLimitSaveResult> {
		const el = transcriptEl;
		const prevHeight = el?.scrollHeight ?? 0;
		const prevTop = el?.scrollTop ?? 0;
		const result = await store.setChatLimit(value);
		await tick();
		if (el) {
			const delta = el.scrollHeight - prevHeight;
			if (delta > 0) el.scrollTop = prevTop + delta;
		}
		return result.ok
			? { ok: true, chatLimit: result.chatLimit }
			: { ok: false, error: result.error };
	}

	// Adapt the store's cwd/LSP results to the cwd-lsp feature's ports.
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

	// Adapt the store's computer results to the computer feature's ports.
	async function saveComputer(computerId: string | null): Promise<ComputerSaveResult | null> {
		const result = await store.setComputer(computerId);
		if (result === null) return null;
		return result.ok ? { ok: true, computerId: result.computerId } : { ok: false, error: result.error };
	}

	const loadComputerStatus: LoadComputerStatus = async (
		alias: string,
	): Promise<ComputerStatusResult | null> => {
		const result = await store.computerStatus(alias);
		if (result === null) return null;
		return result.ok ? { ok: true, status: result.response } : { ok: false, error: result.error };
	};

	const testComputer: TestComputer = async (
		alias: string,
	): Promise<TestComputerResult | null> => {
		const result = await store.testComputer(alias);
		if (result === null) return null;
		return result.ok ? { ok: true, response: result.response } : { ok: false, error: result.error };
	};

	async function loadMcpStatus(): Promise<McpStatusResult | null> {
		const result = await store.mcpStatus();
		if (result === null) return null;
		return result.ok
			? { ok: true, cwd: result.response.cwd, servers: result.response.servers }
			: { ok: false, error: result.error };
	}

	// Adapt the store's system prompt results to the system-prompt feature's ports.
	const loadSystemPromptPrompt: LoadSystemPromptAlias = () => store.loadSystemPrompt();

	const loadSystemPromptVariablesPrompt: LoadSystemPromptVariablesAlias = () =>
		store.loadSystemPromptVariables();

	const saveSystemPromptPrompt: SaveSystemPromptAlias = (template) => store.setSystemPrompt(template);

	// Adapt the store's heartbeat results to the heartbeat feature's ports. The
	// store returns the feature's result types directly (the API is a plain REST
	// surface, not a transport-contract type), so the adapter is a thin passthrough
	// (kept for structural consistency with cwd-lsp/mcp/computer — see AGENTS.md
	// "contracts are the cross-unit surface").
	async function loadHeartbeatConfig(): Promise<HeartbeatConfigResult> {
		return store.heartbeatConfig();
	}

	async function saveHeartbeatConfig(
		patch: Parameters<typeof store.setHeartbeatConfig>[0],
	): Promise<HeartbeatConfigResult> {
		return store.setHeartbeatConfig(patch);
	}

	async function loadHeartbeatRuns(): Promise<HeartbeatRunsResult> {
		return store.heartbeatRuns();
	}

	async function stopHeartbeatRun(runId: string): Promise<HeartbeatStopResult> {
		return store.stopHeartbeatRun(runId);
	}

	async function loadHeartbeatNextRun(): Promise<HeartbeatNextRunResult> {
		return store.heartbeatNextRun();
	}

	// Run-chat modal: open a live watch on the run's conversation (the store owns
	// the ChatStore + the `chat.subscribe` stream), and tear it down on close.
	function openRunChat(conversationId: string): ChatStore {
		return store.watchConversation(conversationId);
	}
	function closeRunChat(conversationId: string): void {
		store.unwatchConversation(conversationId);
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
				statusFor={(id) => store.conversationStatus(id)}
				onSelect={(id) => store.selectTab(id)}
				onClose={(id) => store.closeTab(id)}
				onNewDraft={() => store.newDraft()}
				onRename={(id, title) => store.renameTab(id, title)}
			/>
			<span
				class="shrink-0 select-none px-1 font-mono text-[10px] leading-none text-base-content/30"
				title="Build version (git short hash)"
			>
				{__APP_VERSION__}
			</span>
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
						<ChatView
							chunks={store.activeChat.chunks}
							turnMetrics={store.activeChat.turnMetrics}
							hasEarlier={store.activeChat.hasEarlier}
							onShowEarlier={handleShowEarlier}
							thinkingKeyBase={store.activeChat.thinkingKeyBase}
							providerRetry={store.activeChat.providerRetry}
						/>
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

		{#if hasQueuedMessages && messageQueueSpec !== null}
			<!-- Pending steering messages (the message-queue surface). Rendered via
			     the generic SurfaceView (dispatches on rendererId, never surface id);
			     only shown when the queue is non-empty — an idle queue is hidden. -->
			<div class="px-4 pt-2">
				<SurfaceView spec={messageQueueSpec} onInvoke={handleInvoke} />
			</div>
		{/if}

		<Composer
			onSend={handleSend}
			onQueue={handleQueue}
			onStop={handleStop}
			contextSize={store.activeChat.currentContextSize}
			contextWindow={store.modelInfo[store.activeModel]?.contextWindow}
			status={store.activeChat.error
				? "error"
				: store.activeChat.generating
					? "running"
					: "idle"}
		/>
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
			<ViewSidebar kinds={viewKinds} initial={sidebarPanels} onChange={handleSidebarChange} content={viewContent} />
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

{#if store.fatalError}
	<ErrorModal error={store.fatalError} onDismiss={() => store.clearFatalError()} />
{/if}

{#if systemPromptModalOpen}
	<SystemPromptBuilder
		loadPrompt={loadSystemPromptPrompt}
		savePrompt={saveSystemPromptPrompt}
		loadVariables={loadSystemPromptVariablesPrompt}
		onClose={() => (systemPromptModalOpen = false)}
	/>
{/if}

{#if heartbeatRun !== null}
	<!-- Keyed per run so switching runs (or re-opening) re-mounts the modal — a
	     fresh watch store lifecycle per run. The modal owns the live watch
	     (openChat/closeChat) and the Stop button. -->
	{#key heartbeatRun.id}
		<RunModal
			run={heartbeatRun}
			openChat={openRunChat}
			closeChat={closeRunChat}
			stopRun={stopHeartbeatRun}
			onClose={() => (heartbeatRun = null)}
		/>
	{/key}
{/if}

{#snippet viewContent(kind: string)}
	{#if kind === "model"}
		<div class="flex flex-col gap-3">
			<ModelSelector
			models={store.models}
			selected={store.activeModel}
			onSelect={handleSelectModel}
			modelInfo={store.modelInfo}
		/>
			<!-- Keyed on the workspace conversation (active tab OR draft) so the inputs
			     re-mount per conversation — incl. switching between drafts — and can't
			     bleed across tabs. Editable for a draft too (cwd + effort apply from turn 1). -->
			{#key store.currentConversationId}
				<ReasoningEffortSelector persisted={store.reasoningEffort} save={saveReasoningEffort} />
				<CwdField cwd={store.cwd} canEdit={true} save={saveCwd} />
				<ComputerField
					computerId={store.computerId}
					canEdit={true}
					computers={store.computers}
					save={saveComputer}
					loadStatus={loadComputerStatus}
					test={testComputer}
				/>
			{/key}
		</div>
	{:else if kind === "lsp"}
		<!-- Re-mount per conversation (incl. draft) so the loaded server list is isolated. -->
		{#key store.currentConversationId}
			<LspStatusView cwd={store.cwd} canView={true} load={loadLspStatus} />
		{/key}
	{:else if kind === "mcp"}
		<!-- Re-mount per conversation (incl. draft) so the loaded server list is isolated. -->
		{#key store.currentConversationId}
			<McpStatusView cwd={store.cwd} canView={true} load={loadMcpStatus} />
		{/key}
	{:else if kind === "extensions"}
		<section>
			<h3 class="mb-1 text-xs font-semibold uppercase opacity-60">Frontend modules</h3>
			<Table columns={MODULE_COLUMNS} rows={loadedModules} />
		</section>
		<section class="mt-4 flex flex-col gap-3">
			<h3 class="text-xs font-semibold uppercase opacity-60">Surfaces</h3>
			{#each store.surfaces.filter((s) => s.id !== CACHE_WARMING_ID && s.id !== MESSAGE_QUEUE_ID && s.id !== TODO_ID) as spec (spec.id)}
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
	{:else if kind === "tasks"}
		<!-- Re-mount per conversation so the task list is isolated per conversation. -->
		{#key store.activeConversationId}
			{#if todoData !== null && todoData.todos.length > 0}
				<TodoList payload={todoData} />
			{:else}
				<p class="text-xs opacity-60">No tasks yet.</p>
			{/if}
		{/key}
	{:else if kind === "compaction"}
		<!-- Re-mount per conversation so the percent + feedback can't bleed across tabs. -->
		{#key store.currentConversationId}
			<CompactionView
				percent={store.compactPercent}
				canCompact={store.activeConversationId !== null}
				{compactNow}
				savePercent={saveCompactPercent}
			/>
		{/key}
	{:else if kind === "system-prompt"}
		<!-- Global system prompt template. Opens a full-page modal editor (half
		     template / half variable palette). Not conversation-scoped (no {#key}). -->
		<div class="flex flex-col gap-2">
			<p class="text-xs opacity-60">
				Edit the global system prompt template with variable placeholders. Opens a full-page editor.
			</p>
			<button
				type="button"
				class="btn btn-primary btn-sm"
				onclick={() => (systemPromptModalOpen = true)}
			>
				Open builder
			</button>
		</div>
	{:else if kind === "settings"}
		<!-- FE-local settings. Not conversation-scoped (no {#key}: the chat limit is
		     global), so the field stays mounted across tab switches. -->
		<div class="flex flex-col gap-3">
			<ChatLimitField chatLimit={store.chatLimit} save={saveChatLimit} />
		</div>
	{:else if kind === "heartbeat"}
		<!-- Workspace-scoped autonomous-agent heartbeat (config + run history).
		     Not conversation-scoped (no {#key}); the config + runs are per-workspace. -->
		<HeartbeatView
			models={store.models}
			loadConfig={loadHeartbeatConfig}
			saveConfig={saveHeartbeatConfig}
			loadRuns={loadHeartbeatRuns}
			stopRun={stopHeartbeatRun}
			loadVariables={loadSystemPromptVariablesPrompt}
			loadDefaultPrompt={loadSystemPromptPrompt}
			loadNextRun={loadHeartbeatNextRun}
			onOpenRun={(run) => (heartbeatRun = run)}
		/>
	{/if}
{/snippet}
