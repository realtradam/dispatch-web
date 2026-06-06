<script lang="ts">
	import type { InvokeMessage } from "@dispatch/ui-contract";
	import { SurfaceView } from "../features/surface-host";
	import { ChatView, Composer } from "../features/chat";
	import type { AppStore } from "./store.svelte";

	let { store }: { store: AppStore } = $props();

	function handleSelect(surfaceId: string) {
		store.select(surfaceId);
	}

	function handleInvoke(msg: InvokeMessage) {
		store.invoke(msg.surfaceId, msg.actionId, msg.payload);
	}

	function handleSend(text: string) {
		store.chat.send(text);
	}
</script>

<main>
	<h1>Dispatch</h1>

	{#if store.lastError}
		<div role="alert">
			<strong>Error:</strong>
			{store.lastError.message}
		</div>
	{/if}

	{#if store.chat.error}
		<div role="alert">
			<strong>Chat error:</strong>
			{store.chat.error}
		</div>
	{/if}

	<section>
		<h2>Chat</h2>
		<ChatView chunks={store.chat.chunks} />
		<Composer onSend={handleSend} />
	</section>

	<section>
		<h2>Surfaces</h2>
		{#if store.catalog.length === 0}
			<p>No surfaces available</p>
		{:else}
			<ul>
				{#each store.catalog as entry (entry.id)}
					<li>
						<button
							aria-current={entry.id === store.selectedId ? "true" : undefined}
							onclick={() => handleSelect(entry.id)}
						>
							{entry.title}
							<span>({entry.region})</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if store.selectedSpec}
		<section>
			<SurfaceView spec={store.selectedSpec} onInvoke={handleInvoke} />
		</section>
	{/if}
</main>
