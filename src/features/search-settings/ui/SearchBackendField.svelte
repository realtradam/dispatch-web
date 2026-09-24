<script lang="ts">
  /**
   * The "Search backend" dropdown (Settings pane) — picks the engine backing
   * the `web_search` tool's SEARCH mode. GLOBAL setting persisted on the
   * backend (`GET/PUT /search/config`); SAVE ON CHANGE (no Set button).
   * Unconfigured backends stay listed but disabled; "None (search disabled)"
   * is the off state. The config affects search mode only — scrape/crawl
   * always route to the self-hosted Firecrawl backend.
   *
   * Thin shell: seeds/reverts the select from the last PERSISTED value, shows
   * saving/saved/error feedback, and degrades to a disabled field with a
   * "search not available" hint when the backend's search-config service is
   * not loaded (503) — matching heartbeat's degrade philosophy.
   */
  import { untrack } from "svelte";
  import {
    buildSearchBackendOptions,
    type LoadSearchBackendConfig,
    NONE_BACKEND_ID,
    type SaveSearchBackend,
    searchBackendChanged,
    searchBackendLabel,
    type SearchBackendConfig,
  } from "../logic/view-model";

  let {
    load,
    save,
  }: {
    /** Fetch the persisted global config (called once on mount). */
    load: LoadSearchBackendConfig;
    /** Persist a new backend selection (save-on-change). */
    save: SaveSearchBackend;
  } = $props();

  let config = $state<SearchBackendConfig | null>(null);
  let loading = $state(true);
  let loadUnavailable = $state(false);
  let loadError = $state<string | null>(null);
  let selected = $state("");
  let lastSeed = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);
  let justSaved = $state<string | null>(null);

  $effect(() => {
    // Load ONCE on first mount (the setting is GLOBAL — no workspace
    // re-seeding); guard against strict-mode double effects via the flag.
    untrack(async () => {
      if (config !== null || loadUnavailable) return;
      loading = true;
      loadError = null;
      const result = await load();
      loading = false;
      if (result.ok) {
        config = result.config;
        selected = result.config.backend;
        lastSeed = result.config.backend;
      } else {
        loadUnavailable = result.unavailable === true;
        loadError = result.error;
      }
    });
  });

  const options = $derived(config === null ? [] : buildSearchBackendOptions(config));
  const persisted = $derived(lastSeed);

  async function handleChange(): Promise<void> {
    if (saving || config === null) return;
    const next = selected;
    if (!searchBackendChanged(next, persisted)) return;
    saving = true;
    error = null;
    justSaved = null;
    const result = await save(next);
    saving = false;
    if (result.ok) {
      config = result.config;
      // Reflect the persisted value back (the backend is authoritative).
      selected = result.config.backend;
      lastSeed = result.config.backend;
      justSaved = searchBackendLabel(result.config, result.config.backend);
    } else {
      error = result.error;
      // Revert the select to the last persisted value on failure.
      selected = persisted;
    }
  }

  function onSelectChange(): void {
    error = null;
    justSaved = null;
    void handleChange();
  }
</script>

<div class="flex flex-col gap-1">
  <span class="text-xs font-semibold uppercase opacity-60">Search backend</span>
  {#if loading}
    <div class="skeleton h-7 w-full" aria-label="Search backend loading"></div>
  {:else if config === null}
    <select
      class="select select-bordered select-sm w-full text-xs"
      disabled
      aria-label="Search backend"
    >
      <option>{loadUnavailable ? "Search not available" : (loadError ?? "Unavailable")}</option>
    </select>
    {#if loadError && !loadUnavailable}
      <p class="text-xs text-error">{loadError}</p>
    {/if}
  {:else}
    <select
      class="select select-bordered select-sm w-full text-xs"
      bind:value={selected}
      disabled={saving}
      onchange={onSelectChange}
      aria-label="Search backend"
    >
      {#each options as option (option.id)}
        <option value={option.id} disabled={option.disabled}>{option.label}</option>
      {/each}
    </select>
    {#if saving}
      <p class="text-xs opacity-60 flex items-center gap-1">
        <span class="loading loading-spinner loading-xs"></span>
        Saving…
      </p>
    {:else if error}
      <p class="text-xs text-error">{error}</p>
    {:else if justSaved !== null}
      <p class="text-xs text-success">Saved: {justSaved}.</p>
    {/if}
  {/if}
  {#if !loadUnavailable}
    <p class="text-xs opacity-50">
      Affects the web_search tool's <em>search</em> mode only — scrape and crawl always use the
      self-hosted Firecrawl backend, and the tool's map mode has been removed.
    </p>
  {/if}
</div>
