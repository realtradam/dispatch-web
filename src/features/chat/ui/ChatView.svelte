<script lang="ts">
	import { groupRenderedChunks, type RenderedChunk } from "../index";
	import type { TelemetryState } from "../../../core/telemetry";
	import { stepMetrics, stepTps } from "../../../core/telemetry";

	interface Props {
		chunks: readonly RenderedChunk[];
		telemetry: TelemetryState;
		currentTurnId: string | null;
	}

	let { chunks, telemetry, currentTurnId }: Props = $props();

	const groups = $derived(groupRenderedChunks(chunks));

	function formatMs(ms: number): string {
		if (ms < 1000) return `${Math.round(ms)}ms`;
		const s = ms / 1000;
		return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
	}

	const rows = $derived.by(() => {
		let thinking = 0;
		let stepIdx = 0;
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
			const si = stepIdx;
			if (group.kind === "tool-batch" || (group.kind === "single" && (group.chunk.chunk.type === "tool-call" || group.chunk.chunk.type === "tool-result"))) {
				stepIdx++;
			}
			return { group, key, stepIdx: si };
		});
	});
</script>

{#snippet chunkRow(rendered: RenderedChunk, sIdx: number)}
	{#if rendered.role === "user"}
		<div class="chat chat-start">
			<div class="chat-bubble chat-bubble-primary">
				{#if rendered.chunk.type === "text"}
					<p>{rendered.chunk.text}</p>
				{/if}
			</div>
		</div>
	{:else if rendered.chunk.type === "thinking"}
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
		{@const step = currentTurnId ? stepMetrics(telemetry, currentTurnId, sIdx) : undefined}
		{@const toolDur = step?.toolDurationMs}
		<div class="chat chat-start [&>.chat-bubble]:max-w-full [&>.chat-bubble]:p-0">
			<div class="chat-bubble bg-transparent">
				{#if rendered.chunk.type === "tool-call"}
					<div class="w-fit max-w-full rounded-box bg-base-200 p-3 text-sm">
						<div class="flex items-center gap-2">
							<strong>{rendered.chunk.toolName}</strong>
							{#if toolDur !== undefined && toolDur > 0}
								<span class="badge badge-ghost badge-xs ml-auto">{formatMs(toolDur)}</span>
							{/if}
						</div>
						<pre class="text-xs mt-1">{JSON.stringify(rendered.chunk.input, null, 2)}</pre>
					</div>
				{:else}
					<div
						class="w-fit max-w-full rounded-box bg-base-200 p-3 text-sm"
						class:text-error={rendered.chunk.isError}
					>
						<div class="flex items-center gap-2">
							<strong>{rendered.chunk.toolName}</strong>
							{#if toolDur !== undefined && toolDur > 0}
								<span class="badge badge-ghost badge-xs ml-auto">{formatMs(toolDur)}</span>
							{/if}
						</div>
						<pre class="text-xs mt-1">{rendered.chunk.content}</pre>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		{@const step = currentTurnId ? stepMetrics(telemetry, currentTurnId, sIdx) : undefined}
		{@const tps = step ? stepTps(step) : undefined}
		<div class="chat chat-start [&>.chat-bubble]:max-w-5xl">
			<div class="chat-bubble w-full bg-transparent">
				{#if rendered.chunk.type === "text"}
					<ul class="list rounded-box text-sm">
						<li class="list-row">
							<p>{rendered.chunk.text}</p>
						</li>
						{#if step && (step.genTotalMs !== undefined || tps !== undefined || step.usage?.outputTokens !== undefined)}
							<li class="list-row">
								{#if step.genTotalMs !== undefined}
									<span class="badge badge-ghost badge-xs">{formatMs(step.genTotalMs)}</span>
								{/if}
								<span>·</span>
								{#if tps !== undefined}
									<span class="badge badge-ghost badge-xs">{Math.round(tps)} t/s</span>
								{/if}
								<span>·</span>
								{#if step.usage?.outputTokens !== undefined}
									<span class="badge badge-ghost badge-xs">{step.usage.outputTokens} tok</span>
								{/if}
							</li>
						{/if}
					</ul>
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
	{#each rows as { group, key, stepIdx } (key)}
		{#if group.kind === "single"}
			{@render chunkRow(group.chunk, stepIdx)}
		{:else}
			{@const step = currentTurnId ? stepMetrics(telemetry, currentTurnId, stepIdx) : undefined}
			{@const toolDur = step?.toolDurationMs}
			<div class="chat chat-start [&>.chat-bubble]:max-w-full [&>.chat-bubble]:p-0">
				<div class="chat-bubble bg-transparent">
					<ul class="list w-fit max-w-full rounded-box bg-base-200 text-sm">
						{#each group.entries as entry (entry.call.toolCallId)}
							<li class="list-row">
								<div>
									<div class="flex items-center gap-2">
										<strong>{entry.call.toolName}</strong>
										{#if toolDur !== undefined && toolDur > 0}
											<span class="badge badge-ghost badge-xs ml-auto">{formatMs(toolDur)}</span>
										{/if}
									</div>
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
