<script lang="ts">
	import type { SystemPromptVariable } from "@dispatch/transport-contract";
	import { tick, untrack } from "svelte";
	import {
		buildTag,
		groupVariables,
		insertTag,
		isDynamicVariable,
		type LoadSystemPrompt,
		type LoadSystemPromptVariables,
	} from "../../system-prompt";
	import type { SaveHeartbeatConfig } from "../logic/types";
	import {
		effectiveSystemPrompt,
		isInheritingSystemPrompt,
		persistedSystemPrompt,
	} from "../logic/view-model";
	import { portal } from "../../../adapters/portal";

	let {
		systemPrompt,
		taskPrompt,
		loadVariables,
		loadDefaultPrompt,
		saveConfig,
		onSaved,
		onClose,
	}: {
		/**
		 * The heartbeat's persisted system prompt (raw override). Empty = inherit
		 * the global system prompt (the workspace's regular prompt).
		 */
		systemPrompt: string;
		/** The current task prompt (seeded from the loaded config). */
		taskPrompt: string;
		/** Load the available variables (`GET /system-prompt/variables`). */
		loadVariables: LoadSystemPromptVariables;
		/** Load the GLOBAL system prompt (`GET /system-prompt`) — the default the
		 *  heartbeat inherits when its `systemPrompt` is empty. */
		loadDefaultPrompt: LoadSystemPrompt;
		/** Persist both prompts via a partial heartbeat config PUT. */
		saveConfig: SaveHeartbeatConfig;
		/** Called after a successful save with the RAW persisted prompts (system
		 *  may be "" = inherit), so the parent can sync its form. */
		onSaved: (systemPrompt: string, taskPrompt: string) => void;
		onClose: () => void;
	} = $props();

	// The global default system prompt (loaded async on open). Empty until loaded
	// (or when no global prompt is configured) — the editor degrades gracefully.
	let defaultPrompt = $state("");

	// The editable system text. Pre-filled with the EFFECTIVE prompt — the
	// heartbeat's override, or the global default when inheriting (so the user
	// can see + tweak what will run). A pre-filled default is NOT an explicit
	// edit (see `hasChanges`).
	let system = $state(untrack(() => systemPrompt));
	let task = $state(untrack(() => taskPrompt));

	// The raw persisted override at open + after each save (the diff baseline for
	// the system field). Empty = the heartbeat is inheriting the global default.
	// REACTIVE so a successful save can update it to the newly-persisted value —
	// otherwise `systemBaseline` stays pinned to the open-time value and
	// `hasChanges` never clears (the "Save flickers and reverts" bug).
	let loadedSystemRaw = $state(untrack(() => systemPrompt));
	let loadedTask = $state(untrack(() => taskPrompt));

	let variables = $state<readonly SystemPromptVariable[]>([]);
	let varsLoading = $state(false);
	let varsError = $state<string | null>(null);
	let defaultLoading = $state(false);

	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let justSaved = $state(false);

	// The textarea currently focused — variable insertion targets THIS one.
	type Field = "system" | "task";
	let activeField = $state<Field>("system");
	let systemEl = $state<HTMLTextAreaElement | null>(null);
	let taskEl = $state<HTMLTextAreaElement | null>(null);

	const groups = $derived(groupVariables(variables));
	/** The baseline system text to diff against: the effective prompt at open +
	 *  after the last save (override, or the default when inheriting) — so a
	 *  pre-filled default does NOT register as an unsaved change, and a saved
	 *  edit clears `hasChanges` (the baseline tracks the persisted value). */
	const systemBaseline = $derived(effectiveSystemPrompt(loadedSystemRaw, defaultPrompt));
	const hasChanges = $derived(system !== systemBaseline || task !== loadedTask);
	/** Whether the current text matches the default (i.e. saving would inherit). */
	const inheriting = $derived(system === defaultPrompt && defaultPrompt !== "");

	async function loadVars(): Promise<void> {
		untrack(() => {
			varsLoading = true;
			varsError = null;
		});
		const result = await loadVariables();
		varsLoading = false;
		if (result.ok) {
			variables = result.variables;
		} else {
			varsError = result.error;
		}
	}

	async function loadDefault(): Promise<void> {
		untrack(() => {
			defaultLoading = true;
		});
		const result = await loadDefaultPrompt();
		defaultLoading = false;
		if (result.ok) {
			defaultPrompt = result.template;
			// Pre-fill an inheriting (empty) override with the global default so the
			// user can see + tweak what will run — but ONLY if they haven't edited
			// the system field yet (system still equals the open-time raw override).
			// Done here (not in a reactive $effect) so a late-loading default can't
			// clobber an in-flight edit.
			if (isInheritingSystemPrompt(loadedSystemRaw) && system === loadedSystemRaw) {
				system = defaultPrompt;
			}
		}
		// A failed default load is non-fatal: the editor still works with the
		// raw override; only the "inherit" affordance is unavailable.
	}

	async function save(): Promise<void> {
		if (saving || !hasChanges) return;
		saving = true;
		saveError = null;
		justSaved = false;
		// Persist the system prompt via the inheritance helper: matching the
		// default (or empty) → "" (inherit); otherwise the override verbatim.
		const systemToPersist = persistedSystemPrompt(system, defaultPrompt);
		const result = await saveConfig({ systemPrompt: systemToPersist, taskPrompt: task });
		saving = false;
		if (result === null) return;
		if (result.ok) {
			// Advance the diff baseline to the persisted value so `hasChanges`
			// clears (systemBaseline recomputes off loadedSystemRaw). Without this
			// the baseline stays pinned to the open-time value and the Save button
			// never settles ("flickers and reverts to unsaved").
			loadedSystemRaw = systemToPersist;
			loadedTask = task;
			justSaved = true;
			onSaved(systemToPersist, task);
		} else {
			saveError = result.error;
		}
	}

	/** Revert ALL edits to the open-time state (system effective prompt + task). */
	function reset(): void {
		system = systemBaseline;
		task = loadedTask;
		saveError = null;
		justSaved = false;
	}

	/** Reset ONLY the system prompt to the global default (clears any override →
	 *  inherit on save). No-op until the default has loaded. */
	function resetSystemToDefault(): void {
		if (defaultPrompt === "") return;
		system = defaultPrompt;
		saveError = null;
		justSaved = false;
	}

	/**
	 * Insert a variable tag into the ACTIVE textarea at its cursor. The active
	 * field is tracked via focus handlers; insertion uses that field's element +
	 * its own text (so a tag never lands in the wrong box).
	 */
	async function insertAtActive(tag: string): Promise<void> {
		const el = activeField === "system" ? systemEl : taskEl;
		if (el === null) return;
		const start = el.selectionStart;
		const end = el.selectionEnd;
		if (activeField === "system") {
			const ins = insertTag(system, tag, start, end);
			system = ins.template;
			await tick();
			el.focus();
			el.setSelectionRange(ins.cursor, ins.cursor);
		} else {
			const ins = insertTag(task, tag, start, end);
			task = ins.template;
			await tick();
			el.focus();
			el.setSelectionRange(ins.cursor, ins.cursor);
		}
	}

	/** Dynamic (file:<path>) variable: build the tag from the input + insert. */
	async function insertDynamic(type: string, path: string): Promise<void> {
		const trimmed = path.trim();
		if (trimmed.length === 0) return;
		await insertAtActive(buildTag(type, trimmed));
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === "Escape") onClose();
	}

	// Load the variable palette + the global default once on open.
	$effect(() => {
		void loadVars();
		void loadDefault();
	});
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Teleported to <body> (use:portal) so `position: fixed` resolves against the
     VIEWPORT, not the sidebar's `transform: translateX(...)` container — an
     ancestor transform establishes a containing block for `fixed`, which would
     otherwise clip this overlay to the sidebar area. (RunModal/SystemPromptBuilder
     avoid this by rendering at the composition root; this modal lives inside
     HeartbeatView, so it must escape its ancestor.) -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	use:portal
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
	role="dialog"
	aria-modal="true"
	aria-label="Heartbeat prompt editor"
	tabindex="-1"
	onclick={onClose}
	onkeydown={onKeydown}
>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-box bg-base-100 shadow-2xl"
		onclick={(e) => e.stopPropagation()}
	>
		<!-- Header -->
		<div class="flex shrink-0 items-center justify-between border-b border-base-300 px-4 py-3">
			<div class="flex items-center gap-2">
				<h2 class="text-sm font-semibold">Heartbeat Prompts</h2>
				{#if varsLoading}
					<span class="loading loading-spinner loading-xs"></span>
				{/if}
			</div>
			<button
				type="button"
				class="btn btn-ghost btn-sm btn-square"
				onclick={onClose}
				aria-label="Close prompt editor"
			>
				✕
			</button>
		</div>

		<!-- Body: half editor (two boxes) / half variables -->
		<div class="flex min-h-0 flex-1">
			<!-- Left: two text editors (system top, task bottom) -->
			<div class="flex w-1/2 min-w-0 flex-col gap-2 border-r border-base-300 p-4">
				<div class="flex min-h-0 flex-1 flex-col gap-1">
					<div class="flex shrink-0 items-center justify-between gap-2">
						<div class="flex items-center gap-2">
							<span class="text-xs font-semibold uppercase opacity-60">System prompt</span>
							{#if defaultLoading}
								<span class="loading loading-spinner loading-xs"></span>
							{:else if inheriting}
								<span class="badge badge-ghost badge-sm font-normal">Inheriting workspace default</span>
							{/if}
						</div>
						<button
							type="button"
							class="btn btn-ghost btn-xs"
							disabled={defaultPrompt === "" || saving}
							onclick={resetSystemToDefault}
							title="Reset the system prompt to the workspace default (inherit)"
						>
							Reset to default
						</button>
					</div>
					<textarea
						bind:this={systemEl}
						bind:value={system}
						onfocus={() => (activeField = "system")}
						class="textarea textarea-bordered min-h-0 w-full flex-1 resize-none font-mono text-xs"
						placeholder={defaultPrompt || "You are an autonomous agent…"}
						disabled={saving}
						aria-label="Heartbeat system prompt"
					></textarea>
					<p class="shrink-0 text-xs opacity-50">
						{#if inheriting}
							Matches the workspace default — saving will inherit it (no override).
						{:else if defaultPrompt !== ""}
							Editing overrides the workspace default.
						{:else}
							Empty — no system prompt set.
						{/if}
					</p>
				</div>

				<div class="flex min-h-0 flex-1 flex-col gap-1">
					<span class="shrink-0 text-xs font-semibold uppercase opacity-60">Task prompt</span>
					<textarea
						bind:this={taskEl}
						bind:value={task}
						onfocus={() => (activeField = "task")}
						class="textarea textarea-bordered min-h-0 w-full flex-1 resize-none font-mono text-xs"
						placeholder="Check the system status and report…"
						disabled={saving}
						aria-label="Heartbeat task prompt"
					></textarea>
				</div>

				<div class="flex shrink-0 flex-wrap items-center gap-2">
					<button
						type="button"
						class="btn btn-primary btn-sm"
						disabled={saving || !hasChanges}
						onclick={save}
					>
						{#if saving}
							<span class="loading loading-spinner loading-xs"></span>
						{:else}
							Save
						{/if}
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						disabled={!hasChanges}
						onclick={reset}
					>
						Reset
					</button>
					{#if justSaved && !hasChanges}
						<span class="text-xs text-success">Saved.</span>
					{:else if hasChanges}
						<span class="text-xs opacity-60">Unsaved changes</span>
					{/if}
				</div>

				{#if saveError}
					<p class="shrink-0 text-xs text-error">{saveError}</p>
				{/if}
			</div>

			<!-- Right: variable palette -->
			<div class="flex w-1/2 min-w-0 flex-col overflow-y-auto p-4">
				<h3 class="mb-2 shrink-0 text-xs font-semibold uppercase opacity-60">Variables</h3>
				<p class="mb-3 shrink-0 text-xs opacity-50">
					Click a variable to insert it into the focused prompt box.
				</p>
				{#if varsError}
					<p class="text-xs text-error">{varsError}</p>
				{:else if groups.length === 0 && !varsLoading}
					<p class="text-xs opacity-60">No variables available.</p>
				{:else}
					<div class="flex flex-col gap-3">
						{#each groups as group (group.type)}
							<div class="rounded-box bg-base-200 p-3">
								<span class="text-xs font-semibold uppercase opacity-70">{group.type}</span>
								<div class="mt-2 flex flex-wrap gap-1">
									{#each group.variables as variable (variable.type + variable.name)}
										{#if isDynamicVariable(variable)}
											<!-- Dynamic (file:<path>) variable: a path input + Insert button. -->
											<div class="flex items-center gap-1">
												<input
													type="text"
													class="input input-bordered input-xs w-32 font-mono"
													placeholder={variable.name}
													onkeydown={(e) => {
														if (e.key === "Enter") {
															const v = e.currentTarget.value;
															void insertDynamic(variable.type, v);
															e.currentTarget.value = "";
														}
													}}
												/>
												<button
													type="button"
													class="btn btn-xs"
													onclick={(e) => {
														const input = (e.currentTarget as HTMLButtonElement)
															.previousElementSibling as HTMLInputElement | null;
														if (input !== null) {
															void insertDynamic(variable.type, input.value);
															input.value = "";
														}
													}}
												>
													Insert
												</button>
											</div>
										{:else}
											<button
												type="button"
												class="btn btn-xs"
												title={variable.description}
												onclick={() =>
													void insertAtActive(buildTag(variable.type, variable.name))}
											>
												{variable.name}
											</button>
										{/if}
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
