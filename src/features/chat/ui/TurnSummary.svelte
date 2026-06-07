<script lang="ts">
	import type { TelemetryState } from "../../../core/telemetry";
	import {
		stepCount,
		totalInputTokens,
		totalOutputTokens,
		turnMetrics,
		turnTps,
	} from "../../../core/telemetry";

	interface Props {
		telemetry: TelemetryState;
		turnId: string | null;
	}

	let { telemetry, turnId }: Props = $props();

	function formatMs(ms: number): string {
		if (ms < 1000) return `${Math.round(ms)}ms`;
		const s = ms / 1000;
		return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
	}

	const stats = $derived.by(() => {
		if (turnId === null) return null;
		const metrics = turnMetrics(telemetry, turnId);
		if (metrics === undefined) return null;

		const items: { label: string; value: string }[] = [];

		if (metrics.wallMs !== undefined) {
			items.push({ label: "Turn", value: formatMs(metrics.wallMs) });
		}

		const outTokens = totalOutputTokens(telemetry, turnId);
		const inTokens = totalInputTokens(telemetry, turnId);
		if (outTokens !== undefined || inTokens !== undefined) {
			const total = (outTokens ?? 0) + (inTokens ?? 0);
			items.push({ label: "Tokens", value: total.toLocaleString() });
		}
		if (outTokens !== undefined) {
			items.push({ label: "Output", value: outTokens.toLocaleString() });
		}
		if (inTokens !== undefined) {
			items.push({ label: "Input", value: inTokens.toLocaleString() });
		}

		const count = stepCount(telemetry, turnId);
		if (count > 0) {
			items.push({ label: "Steps", value: String(count) });
		}

		const tps = turnTps(telemetry, turnId);
		if (tps !== undefined) {
			items.push({ label: "TPS", value: `${Math.round(tps)} t/s` });
		}

		return items;
	});
</script>

{#if stats !== null}
	<div class="chat chat-start [&>.chat-bubble]:max-w-5xl">
		<div class="chat-bubble w-full bg-transparent">
			<div class="stats stats-vertical lg:stats-horizontal">
				{#each stats as stat}
					<div class="stat">
						<div class="stat-title">{stat.label}</div>
						<div class="stat-value text-sm">{stat.value}</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}
