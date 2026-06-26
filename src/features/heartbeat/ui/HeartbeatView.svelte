<script lang="ts">
	import { untrack } from "svelte";
	import type { ReasoningEffort } from "@dispatch/transport-contract";
	import { isReasoningEffort } from "../../chat/reasoning-effort";
	import {
		badgeForStatus,
		type Badge,
		emptyForm,
		effortOptions,
		formDiffers,
		formFromConfig,
		patchFromForm,
		viewRuns,
		type HeartbeatFormState,
		type HeartbeatRunView,
	} from "../logic/view-model";
	import type {
		LoadHeartbeatConfig,
		LoadHeartbeatRuns,
		SaveHeartbeatConfig,
		StopHeartbeatRun,
	} from "../logic/types";
	import type {
		LoadSystemPrompt,
		LoadSystemPromptVariables,
	} from "../../system-prompt";
	import PromptEditor from "./PromptEditor.svelte";

	let {
		models,
		loadConfig,
		saveConfig,
		loadRuns,
		stopRun,
		loadVariables,
		loadDefaultPrompt,
		onOpenRun,
	}: {
		/** The available model names (for the config's model dropdown). */
		models: readonly string[];
		loadConfig: LoadHeartbeatConfig;
		saveConfig: SaveHeartbeatConfig;
		loadRuns: LoadHeartbeatRuns;
		stopRun: StopHeartbeatRun;
		/** Load the available system-prompt variables (palette in the prompt editor). */
		loadVariables: LoadSystemPromptVariables;
		/** Load the global system prompt — the default the heartbeat inherits when
		 *  its `systemPrompt` is empty (the workspace's regular prompt). */
		loadDefaultPrompt: LoadSystemPrompt;
		/** Open a run's chat in the fullscreen modal (composition-root wires the live watch). */
		onOpenRun: (run: HeartbeatRunView) => void;
	} = $props();

	const badgeClass: Record<Badge, string> = {
		success: "badge-success",
		warning: "badge-warning",
		error: "badge-error",
		neutral: "badge-ghost",
	};

	const effortOpts = effortOptions();

	// ── Config form ──────────────────────────────────────────────────────────
	let form = $state<HeartbeatFormState>(emptyForm());
	/** The last successfully loaded/saved config, to diff the form against. */
	let loadedConfig = $state<HeartbeatFormState>(emptyForm());
	let configLoading = $state(false);
	let configError = $state<string | null>(null);
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let justSaved = $state(false);
	let hasConfig = $state(false);
	let promptEditorOpen = $state(false);

	const hasChanges = $derived(formDiffers(form, loadedConfig) && hasConfig);

	async function refreshConfig(): Promise<void> {
		configLoading = true;
		configError = null;
		const result = await loadConfig();
		configLoading = false;
		if (result === null) return;
		if (result.ok) {
			hasConfig = true;
			form = formFromConfig(result.config);
			loadedConfig = formFromConfig(result.config);
			saveError = null;
		} else {
			configError = result.error;
		}
	}

	async function handleSave(): Promise<void> {
		if (saving || !hasChanges) return;
		saving = true;
		saveError = null;
		justSaved = false;
		const result = await saveConfig(patchFromForm(form));
		saving = false;
		if (result === null) return;
		if (result.ok) {
			// Re-seed from the authoritative response so the form tracks the server.
			form = formFromConfig(result.config);
			loadedConfig = formFromConfig(result.config);
			justSaved = true;
		} else {
			saveError = result.error;
		}
	}

	// The enable toggle is the primary action — persist it immediately (don't
	// require a separate Save). Mirrors the codebase's save-on-change controls.
	async function handleToggleEnabled(): Promise<void> {
		if (saving) return;
		const next = !form.enabled;
		form = { ...form, enabled: next };
		saving = true;
		saveError = null;
		justSaved = false;
		const result = await saveConfig({ enabled: next });
		saving = false;
		if (result === null) return;
		if (result.ok) {
			form = formFromConfig(result.config);
			loadedConfig = formFromConfig(result.config);
			justSaved = true;
		} else {
			saveError = result.error;
			// Revert the toggle to the last-known state.
			form = { ...form, enabled: loadedConfig.enabled };
		}
	}

	// ── Runs list (polls while mounted) ───────────────────────────────────────
	let runs = $state<readonly HeartbeatRunView[]>([]);
	let runsLoading = $state(false);
	let runsError = $state<string | null>(null);
	let stoppingId = $state<string | null>(null);
	let stopError = $state<string | null>(null);
	let pollHandle: ReturnType<typeof setInterval> | null = null;

	const RUN_POLL_MS = 4000;

	async function refreshRuns(): Promise<void> {
		runsLoading = true;
		runsError = null;
		const result = await loadRuns();
		runsLoading = false;
		if (result === null) return;
		if (result.ok) {
			runs = viewRuns(result.runs);
		} else {
			runsError = result.error;
		}
	}

	async function handleStop(runId: string): Promise<void> {
		if (stoppingId !== null) return;
		stoppingId = runId;
		stopError = null;
		const result = await stopRun(runId);
		stoppingId = null;
		if (result === null) return;
		if (result.ok) {
			await refreshRuns();
		} else {
			stopError = result.error;
		}
	}

	// Load config + runs on mount, and poll runs while the view is alive so a
	// running run's completion/stopped transition shows without a manual refresh.
	$effect(() => {
		untrack(() => {
			void refreshConfig();
			void refreshRuns();
		});
		pollHandle = setInterval(() => {
			void refreshRuns();
		}, RUN_POLL_MS);
		return () => {
			if (pollHandle !== null) clearInterval(pollHandle);
			pollHandle = null;
		};
	});

	// A relative label ("5m ago") drifts as time passes; re-derive runs every
	// minute so the list stays fresh without a full re-fetch.
	let tick = $state(0);
	$effect(() => {
		const h = setInterval(() => {
			tick++;
		}, 60000);
		return () => clearInterval(h);
	});
	const runsView = $derived.by(() => {
		void tick; // depend on the ticker
		return runs;
	});
</script>

<div class="flex flex-col gap-3">
	<!-- Enable / status header -->
	<section class="flex items-center justify-between gap-2">
		<div class="flex items-center gap-2">
			<button
				type="button"
				role="switch"
				aria-checked={form.enabled}
				aria-label="Toggle heartbeat"
				class="toggle toggle-sm"
				class:toggle-primary={form.enabled}
				disabled={saving || configLoading}
				onclick={handleToggleEnabled}
			></button>
			<span class="text-xs font-semibold uppercase opacity-60">
				{#if configLoading}
					Loading…
				{:else if form.enabled}
					Enabled
				{:else}
					Disabled
				{/if}
			</span>
		</div>
		<button
			type="button"
			class="btn btn-ghost btn-xs"
			disabled={configLoading}
			onclick={() => refreshConfig()}
			aria-label="Refresh heartbeat config"
		>
			{#if configLoading}
				<span class="loading loading-spinner loading-xs"></span>
			{:else}
				Refresh
			{/if}
		</button>
	</section>

	{#if configError}
		<p class="text-xs text-error">{configError}</p>
	{:else}
		<!-- Prompts (open the full-page editor) -->
		<section class="flex flex-col gap-1">
			<span class="text-xs font-semibold uppercase opacity-60">Prompts</span>
			<button
				type="button"
				class="btn btn-sm btn-outline"
				disabled={saving || configLoading}
				onclick={() => (promptEditorOpen = true)}
			>
				Edit prompts
			</button>
			<p class="text-xs opacity-50">
				Open the editor for the system + task prompts (with a variable palette).
			</p>
		</section>

		<!-- Model + reasoning effort -->
		<section class="flex flex-col gap-2">
			<div class="flex flex-col gap-1">
				<span class="text-xs font-semibold uppercase opacity-60">Model</span>
				<select
					class="select select-sm w-full"
					value={form.model}
					disabled={saving || configLoading}
					onchange={(e) => (form = { ...form, model: e.currentTarget.value })}
					aria-label="Heartbeat model"
				>
					{#if models.length === 0}
						<option value="">No models available</option>
					{:else}
						<option value="" disabled>Select a model</option>
						{#each models as model (model)}
							<option value={model}>{model}</option>
						{/each}
					{/if}
				</select>
			</div>

			<div class="flex flex-col gap-1">
				<span class="text-xs font-semibold uppercase opacity-60">Reasoning effort</span>
				<select
					class="select select-sm w-full"
					value={form.reasoningEffort}
					disabled={saving || configLoading}
					onchange={(e) => {
						const v = e.currentTarget.value;
						if (isReasoningEffort(v)) form = { ...form, reasoningEffort: v as ReasoningEffort };
					}}
					aria-label="Heartbeat reasoning effort"
				>
					{#each effortOpts as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</div>
		</section>

		<!-- Interval (hours + minutes) -->
		<section class="flex flex-col gap-1">
			<span class="text-xs font-semibold uppercase opacity-60">Interval</span>
			<div class="flex items-center gap-2">
				<input
					type="number"
					class="input input-bordered input-sm w-20"
					min="0"
					max="24"
					value={form.intervalHours}
					disabled={saving || configLoading}
					oninput={(e) => {
						const n = Number.parseInt(e.currentTarget.value, 10);
						form = { ...form, intervalHours: Number.isNaN(n) ? 0 : n };
					}}
					onchange={(e) => {
						const clamped = Math.max(0, Math.min(24, form.intervalHours));
						form = { ...form, intervalHours: clamped };
						e.currentTarget.value = String(clamped);
					}}
					aria-label="Heartbeat interval hours"
				/>
				<span class="text-xs opacity-60">h</span>
				<input
					type="number"
					class="input input-bordered input-sm w-20"
					min="0"
					max="59"
					value={form.intervalMinutes}
					disabled={saving || configLoading}
					oninput={(e) => {
						const n = Number.parseInt(e.currentTarget.value, 10);
						form = { ...form, intervalMinutes: Number.isNaN(n) ? 0 : n };
					}}
					onchange={(e) => {
						const clamped = Math.max(0, Math.min(59, form.intervalMinutes));
						form = { ...form, intervalMinutes: clamped };
						e.currentTarget.value = String(clamped);
					}}
					aria-label="Heartbeat interval minutes"
				/>
				<span class="text-xs opacity-60">m between runs</span>
			</div>
		</section>

		<!-- Save -->
		<section class="flex flex-col gap-1">
			<button
				type="button"
				class="btn btn-sm btn-primary"
				disabled={!hasChanges || saving || configLoading}
				onclick={handleSave}
			>
				{#if saving}
					<span class="loading loading-spinner loading-xs"></span>
					Saving…
				{:else}
					Save config
				{/if}
			</button>
			{#if saveError}
				<p class="text-xs text-error">{saveError}</p>
			{:else if justSaved}
				<p class="text-xs text-success">Saved.</p>
			{/if}
		</section>
	{/if}

	<!-- Runs list -->
	<section class="flex flex-col gap-1">
		<div class="flex items-center justify-between gap-2">
			<span class="text-xs font-semibold uppercase opacity-60">Runs</span>
			<button
				type="button"
				class="btn btn-ghost btn-xs"
				disabled={runsLoading}
				onclick={() => refreshRuns()}
				aria-label="Refresh heartbeat runs"
			>
				{#if runsLoading}
					<span class="loading loading-spinner loading-xs"></span>
				{:else}
					Refresh
				{/if}
			</button>
		</div>

		{#if runsError}
			<p class="text-xs text-error">{runsError}</p>
		{:else if runs.length === 0 && !runsLoading}
			<p class="text-xs opacity-60">No runs yet. Enable the heartbeat to start the loop.</p>
		{:else}
			<ul class="flex max-h-72 flex-col gap-1 overflow-y-auto">
				{#each runsView as run (run.id)}
					<li>
						<button
							type="button"
							class="flex w-full items-center justify-between gap-2 rounded-box bg-base-200 p-2 text-left hover:bg-base-300"
							onclick={() => onOpenRun(run)}
							aria-label="Open heartbeat run {run.id} chat"
						>
							<span class="flex min-w-0 flex-col gap-0.5">
								<span class="truncate font-mono text-xs opacity-70">{run.id}</span>
								<span class="text-xs opacity-60">
									{run.relativeLabel} · {run.timeLabel}
								</span>
							</span>
							<span class="flex items-center gap-1">
								{#if run.busy}
									<span class="loading loading-spinner loading-xs"></span>
								{/if}
								<span class="badge badge-sm {badgeClass[run.badge]}">{run.statusLabel}</span>
							</span>
						</button>
						{#if run.busy}
							<button
								type="button"
								class="btn btn-ghost btn-xs mt-0.5 text-xs"
								disabled={stoppingId === run.id}
								onclick={() => handleStop(run.id)}
							>
								{#if stoppingId === run.id}
									<span class="loading loading-spinner loading-xs"></span>
									Stopping…
								{:else}
									Stop
								{/if}
							</button>
						{/if}
					</li>
				{/each}
			</ul>
			{#if stopError}
				<p class="text-xs text-error">{stopError}</p>
			{/if}
		{/if}
	</section>
</div>

{#if promptEditorOpen}
	<PromptEditor
		systemPrompt={form.systemPrompt}
		taskPrompt={form.taskPrompt}
		{loadVariables}
		{loadDefaultPrompt}
		{saveConfig}
		onSaved={(systemPrompt, taskPrompt) => {
			// Sync the form + the diff baseline so the main Save button + formDiffers
			// stay accurate (the editor persisted the prompts already). `systemPrompt`
			// may be "" (inherit) — the form stores the raw override.
			form = { ...form, systemPrompt, taskPrompt };
			loadedConfig = { ...loadedConfig, systemPrompt, taskPrompt };
			justSaved = true;
		}}
		onClose={() => (promptEditorOpen = false)}
	/>
{/if}
