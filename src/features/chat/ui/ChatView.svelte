<script lang="ts">
	import type { RenderedChunk } from "../index";

	let { chunks }: { chunks: readonly RenderedChunk[] } = $props();
</script>

<div class="flex flex-col gap-2 p-4 pl-6" role="log" aria-live="polite">
	{#each chunks as rendered, i (rendered.seq != null ? `c${rendered.seq}` : `p${i}`)}
		{#if rendered.role === "user"}
			<!-- User: a speech bubble, left-aligned -->
			<div class="chat chat-start">
				<div class="chat-bubble chat-bubble-primary" class:opacity-50={rendered.provisional}>
					{#if rendered.chunk.type === "text"}
						<p>{rendered.chunk.text}</p>
					{/if}
				</div>
			</div>
		{:else if rendered.chunk.type === "tool-call" || rendered.chunk.type === "tool-result"}
			<!-- Tool: a regular (non-speech) card. Nested in the chat-start grid via
			     a transparent, padding-stripped chat-bubble shim so the card inherits
			     the same left offset as the bubble bodies (no magic margin). -->
			<div class="chat chat-start [&>.chat-bubble]:max-w-full [&>.chat-bubble]:p-0">
				<div class="chat-bubble bg-transparent" class:opacity-50={rendered.provisional}>
					{#if rendered.chunk.type === "tool-call"}
						<div class="w-fit max-w-full rounded-box bg-base-200 p-3 text-sm">
							<strong>{rendered.chunk.toolName}</strong>
							<pre class="text-xs mt-1">{JSON.stringify(rendered.chunk.input, null, 2)}</pre>
						</div>
					{:else}
						<div
							class="w-fit max-w-full rounded-box bg-base-200 p-3 text-sm"
							class:text-error={rendered.chunk.isError}
						>
							<strong>{rendered.chunk.toolName}</strong>
							<pre class="text-xs mt-1">{rendered.chunk.content}</pre>
						</div>
					{/if}
				</div>
			</div>
		{:else}
			<!-- Assistant / system / error: an INVISIBLE speech bubble — the same
			     DaisyUI chat-start grid as the user bubble, so it inherits the
			     identical left spacing (incl. the small leading gap). Transparent
			     bg means no visible body and no visible tail; full width capped to
			     a readable column. -->
			<div class="chat chat-start [&>.chat-bubble]:max-w-5xl">
				<div
					class="chat-bubble w-full bg-transparent"
					class:opacity-50={rendered.provisional}
				>
					{#if rendered.chunk.type === "text"}
						<p>{rendered.chunk.text}</p>
					{:else if rendered.chunk.type === "thinking"}
						<details>
							<summary>Thinking</summary>
							<p>{rendered.chunk.text}</p>
						</details>
					{:else if rendered.chunk.type === "error"}
						<div class="text-error" role="alert">
							{rendered.chunk.message}
							{#if rendered.chunk.code}
								<span class="text-xs opacity-70">[{rendered.chunk.code}]</span>
							{/if}
						</div>
					{:else if rendered.chunk.type === "system"}
						<div class="text-sm opacity-70">{rendered.chunk.text}</div>
					{/if}
				</div>
			</div>
		{/if}
	{/each}
</div>
