<script lang="ts">
	import type { RenderedChunk } from "../index";

	let { chunks }: { chunks: readonly RenderedChunk[] } = $props();
</script>

<div class="chat-transcript" role="log" aria-live="polite">
	{#each chunks as rendered (rendered)}
		<article
			class="message message--{rendered.role}"
			class:message--provisional={rendered.provisional}
		>
			<header class="message__role">{rendered.role}</header>
			<div class="message__content">
				{#if rendered.chunk.type === "text"}
					<p>{rendered.chunk.text}</p>
				{:else if rendered.chunk.type === "thinking"}
					<details>
						<summary>Thinking</summary>
						<p>{rendered.chunk.text}</p>
					</details>
				{:else if rendered.chunk.type === "tool-call"}
					<div class="tool-call">
						<strong>{rendered.chunk.toolName}</strong>
						<pre>{JSON.stringify(rendered.chunk.input, null, 2)}</pre>
					</div>
				{:else if rendered.chunk.type === "tool-result"}
					<div class="tool-result" class:tool-result--error={rendered.chunk.isError}>
						<strong>{rendered.chunk.toolName}</strong>
						<pre>{rendered.chunk.content}</pre>
					</div>
				{:else if rendered.chunk.type === "error"}
					<div class="error" role="alert">
						{rendered.chunk.message}
						{#if rendered.chunk.code}
							<span class="error__code">[{rendered.chunk.code}]</span>
						{/if}
					</div>
				{:else if rendered.chunk.type === "system"}
					<div class="system">{rendered.chunk.text}</div>
				{/if}
			</div>
		</article>
	{/each}
</div>
