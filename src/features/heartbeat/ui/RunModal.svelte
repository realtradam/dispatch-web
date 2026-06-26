<script lang="ts">
	import { tick } from "svelte";
	import { ChatView } from "../../chat";
	import type { ChatStore } from "../../chat";
	import type { HeartbeatRunView } from "../logic/view-model";
	import type { StopHeartbeatRun } from "../logic/types";

	let {
		run,
		openChat,
		closeChat,
		stopRun,
		onClose,
	}: {
		/** The run to display (its conversation's chat is shown live). */
		run: HeartbeatRunView;
		/**
		 * Open a live watch on a conversation (the store's `watchConversation`):
		 * returns a {@link ChatStore} subscribed to the conversation's turn stream
		 * + history loaded. The modal owns the watch lifecycle — calls
		 * `closeChat` on unmount.
		 */
		openChat: (conversationId: string) => ChatStore;
		/** Dispose + unsubscribe the watch opened by `openChat`. */
		closeChat: (conversationId: string) => void;
		/** Stop the heartbeat run (`POST .../runs/:runId/stop`). */
		stopRun: StopHeartbeatRun;
		onClose: () => void;
	} = $props();

	// Open the live watch ONCE on mount (the modal is keyed per run.id, so a run
	// switch remounts it). `untrack` avoids re-running if the prop fn identity
	// changes — `run.conversationId` is the real dependency, captured once here.
	let chat = $state<ChatStore | null>(null);
	$effect(() => {
		chat = openChat(run.conversationId);
		return () => closeChat(run.conversationId);
	});

	// Live scroll: keep the transcript pinned to the bottom while it streams
	// (unless the reader has scrolled up — then we don't fight them).
	let scrollEl = $state<HTMLDivElement | undefined>();
	let contentEl = $state<HTMLDivElement | undefined>();
	let pinned = $state(true);

	function onScroll() {
		const el = scrollEl;
		if (el === undefined) return;
		pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
	}

	// Follow the bottom on new content while pinned. Reads `chunks.length` so the
	// effect re-runs on every streamed append.
	const chunkCount = $derived(chat?.chunks.length ?? 0);
	$effect(() => {
		void chunkCount;
		if (!pinned) return;
		void tick().then(() => {
			const el = scrollEl;
			if (el !== undefined) el.scrollTop = el.scrollHeight;
		});
	});

	// Stop state.
	let stopping = $state(false);
	let stopError = $state<string | null>(null);

	async function handleStop() {
		if (stopping) return;
		stopping = true;
		stopError = null;
		const result = await stopRun(run.id);
		stopping = false;
		if (result === null) return;
		if (!result.ok) stopError = result.error;
	}

	// The live "running" signal: the chat store's `generating` reflects the
	// actual event stream (turn-start…turn-sealed). True while a turn streams —
	// that is when a Stop is meaningful. Falls back to the run's status snapshot
	// before the stream attaches.
	const live = $derived(chat?.generating ?? run.busy);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Fullscreen overlay. -->
<div class="fixed inset-0 z-50 flex flex-col bg-base-100">
	<!-- Header -->
	<header class="flex items-center justify-between gap-2 border-b border-base-300 px-4 py-2">
		<div class="flex min-w-0 items-center gap-2">
			<button
				type="button"
				class="btn btn-ghost btn-sm"
				onclick={onClose}
				aria-label="Close run chat"
			>
				✕
			</button>
			<span class="truncate font-mono text-xs opacity-70" title="Run id">{run.id}</span>
			{#if live}
				<span class="badge badge-sm badge-warning gap-1">
					<span class="loading loading-spinner loading-xs"></span>
					Running
				</span>
			{:else}
				<span class="badge badge-sm badge-ghost">{run.statusLabel}</span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			{#if stopError}
				<span class="text-xs text-error">{stopError}</span>
			{/if}
			{#if live}
				<button
					type="button"
					class="btn btn-sm btn-error btn-outline"
					disabled={stopping}
					onclick={handleStop}
				>
					{#if stopping}
						<span class="loading loading-spinner loading-xs"></span>
						Stopping…
					{:else}
						Stop
					{/if}
				</button>
			{/if}
		</div>
	</header>

	<!-- Transcript -->
	<div class="relative min-h-0 flex-1">
		<div bind:this={scrollEl} class="h-full overflow-y-auto" onscroll={onScroll}>
			<div bind:this={contentEl} class="p-4">
				{#if chat === null}
					<div class="flex h-full items-center justify-center">
						<span class="loading loading-spinner loading-md"></span>
					</div>
				{:else if chat.chunks.length === 0 && chat.pendingSync}
					<div class="flex h-full items-center justify-center">
						<span class="loading loading-spinner loading-md"></span>
					</div>
				{:else}
					<ChatView
						chunks={chat.chunks}
						turnMetrics={chat.turnMetrics}
						hasEarlier={chat.hasEarlier}
						onShowEarlier={chat.showEarlier}
						thinkingKeyBase={chat.thinkingKeyBase}
						providerRetry={chat.providerRetry}
					/>
				{/if}
			</div>
		</div>
		{#if chat !== null && chat.chunks.length === 0 && !chat.pendingSync}
			<div
				class="pointer-events-none absolute inset-0 flex items-center justify-center"
				aria-hidden="true"
			>
				<span class="select-none text-2xl font-bold opacity-10">No messages</span>
			</div>
		{/if}
	</div>
</div>
