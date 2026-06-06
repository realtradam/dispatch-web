<script lang="ts">
	import type { RenderedChunk } from "../index";

	let { chunks }: { chunks: readonly RenderedChunk[] } = $props();
</script>

<div class="flex flex-col gap-2 p-4" role="log" aria-live="polite">
	{#each chunks as rendered, i (rendered.seq != null ? `c${rendered.seq}` : `p${i}`)}
		<div class="chat {rendered.role === 'user' ? 'chat-start' : 'chat-end'}">
			<div class="chat-header text-xs opacity-70">{rendered.role}</div>
			<div
				class="chat-bubble"
				class:chat-bubble-primary={rendered.role === "user"}
				class:chat-bubble-secondary={rendered.role === "assistant"}
				class:opacity-50={rendered.provisional}
			>
				{#if rendered.chunk.type === "text"}
					<p>{rendered.chunk.text}</p>
				{:else if rendered.chunk.type === "thinking"}
					<details>
						<summary>Thinking</summary>
						<p>{rendered.chunk.text}</p>
					</details>
				{:else if rendered.chunk.type === "tool-call"}
					<div class="text-sm">
						<strong>{rendered.chunk.toolName}</strong>
						<pre class="text-xs mt-1">{JSON.stringify(rendered.chunk.input, null, 2)}</pre>
					</div>
				{:else if rendered.chunk.type === "tool-result"}
					<div class="text-sm" class:text-error={rendered.chunk.isError}>
						<strong>{rendered.chunk.toolName}</strong>
						<pre class="text-xs mt-1">{rendered.chunk.content}</pre>
					</div>
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
	{/each}
</div>
