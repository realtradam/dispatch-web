<script lang="ts">
	import { groupRenderedChunks, type RenderedChunk } from "../index";

	let { chunks }: { chunks: readonly RenderedChunk[] } = $props();

	const groups = $derived(groupRenderedChunks(chunks));

	// Stable per-row keys. Thinking blocks get an ordinal key (`think<n>`) that
	// survives the provisional→committed (seq null → seq N) transition, so the
	// collapse's open/close state is NOT lost when a turn seals. (App isolates
	// these keys per conversation via {#key}.)
	const rows = $derived.by(() => {
		let thinking = 0;
		return groups.map((group, i) => {
			let key: string;
			if (group.kind === "tool-batch") {
				key = `b${group.stepId}`;
			} else if (group.chunk.chunk.type === "thinking") {
				key = `think${thinking++}`;
			} else if (group.chunk.seq != null) {
				key = `c${group.chunk.seq}`;
			} else {
				key = `p${i}`;
			}
			return { group, key };
		});
	});
</script>

{#snippet chunkRow(rendered: RenderedChunk)}
	{#if rendered.role === "user"}
		<!-- User: a speech bubble, left-aligned -->
		<div class="chat chat-start">
			<div class="chat-bubble chat-bubble-primary">
				{#if rendered.chunk.type === "text"}
					<p>{rendered.chunk.text}</p>
				{/if}
			</div>
		</div>
	{:else if rendered.chunk.type === "thinking"}
		<!-- Thinking: a visible bubble (like tool cards), holding a checkbox collapse
		     (no arrow icon, smooth open/close). Title reads "Thinking" + loading dots
		     while generating, then "Thoughts" with no dots once complete. -->
		<div class="chat chat-start [&>.chat-bubble]:max-w-5xl [&>.chat-bubble]:p-0">
			<div class="chat-bubble w-full bg-transparent">
				<div class="collapse w-full rounded-box bg-base-200 text-sm">
					<input type="checkbox" aria-label="Toggle thoughts" />
					<div class="collapse-title flex min-h-0 items-center gap-2 py-2 font-medium">
						<span>{rendered.streaming ? "Thinking" : "Thoughts"}</span>
						{#if rendered.streaming}
							<span class="loading loading-dots loading-sm" aria-label="Generating"></span>
						{/if}
					</div>
					<div class="collapse-content">
						<p class="whitespace-pre-wrap">{rendered.chunk.text}</p>
					</div>
				</div>
			</div>
		</div>
	{:else if rendered.chunk.type === "tool-call" || rendered.chunk.type === "tool-result"}
		<!-- Single tool call/result: a regular (non-speech) card. Nested in the
		     chat-start grid via a transparent, padding-stripped chat-bubble shim so
		     the card inherits the same left offset as the bubble bodies. -->
		<div class="chat chat-start [&>.chat-bubble]:max-w-full [&>.chat-bubble]:p-0">
			<div class="chat-bubble bg-transparent">
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
		<!-- Assistant text / system / error: an INVISIBLE speech bubble — same
		     chat-start grid as the user bubble, so it inherits identical left spacing. -->
		<div class="chat chat-start [&>.chat-bubble]:max-w-5xl">
			<div class="chat-bubble w-full bg-transparent">
				{#if rendered.chunk.type === "text"}
					<p>{rendered.chunk.text}</p>
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
{/snippet}

<div class="flex flex-col gap-2 p-4 pl-6" role="log" aria-live="polite">
	{#each rows as { group, key } (key)}
		{#if group.kind === "single"}
			{@render chunkRow(group.chunk)}
		{:else}
			<!-- Batched tool calls (one step): a single bubble holding a DaisyUI list,
			     one row per call paired with its result. Same chat-start grid shim as
			     the single tool card so it lines up with the other messages. -->
			<div class="chat chat-start [&>.chat-bubble]:max-w-full [&>.chat-bubble]:p-0">
				<div class="chat-bubble bg-transparent">
					<ul class="list w-fit max-w-full rounded-box bg-base-200 text-sm">
						{#each group.entries as entry (entry.call.toolCallId)}
							<li class="list-row">
								<div>
									<strong>{entry.call.toolName}</strong>
									<pre class="text-xs mt-1">{JSON.stringify(entry.call.input, null, 2)}</pre>
									{#if entry.result}
										<pre
											class="text-xs mt-1"
											class:text-error={entry.result.isError}>{entry.result.content}</pre>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				</div>
			</div>
		{/if}
	{/each}
</div>
