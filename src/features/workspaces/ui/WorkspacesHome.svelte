<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { ComputerEntry } from "@dispatch/wire";
  import {
    PluginManager,
    WorkspacePluginModal,
    type PluginsStore,
    type WorkspaceLayoutPort,
  } from "../../plugins";
  import { createLocalStore } from "../../../adapters/local-storage";
  import type { WorkspaceStore } from "../store.svelte";
  import { workspacePath } from "../logic/route";
  import {
    DEFAULT_VIEWPORT,
    geometryFor,
    pack,
    type GridGeometry,
    type Span,
  } from "../logic/tile-layout";
  import {
    createTileLayoutStore,
    TILE_LAYOUT_STORAGE_KEY,
    type TileLayoutStore,
  } from "../tile-layout-store.svelte";
  import HomeHeader from "./HomeHeader.svelte";
  import HomeTileGrid from "./HomeTileGrid.svelte";
  import TileActionBar from "./TileActionBar.svelte";
  import ResizePicker from "./ResizePicker.svelte";
  import WorkspaceDetails from "./WorkspaceDetails.svelte";

  let {
    store,
    onNavigate,
    computers,
    hasActive,
    plugins,
    layout,
    tiles: tilesOverride,
  }: {
    store: WorkspaceStore;
    onNavigate: (path: string) => void;
    computers: readonly ComputerEntry[];
    /**
     * Optional port: whether the workspace has at least one active
     * (generating / queued) conversation — the tile's live indicator.
     * Wired by the composition root to the app store. Absent → no indicator.
     */
    hasActive?: (workspaceId: string) => boolean;
    /**
     * The plugin manager store (plan 07): drives the header's global
     * "Plugins" button + the action bar's per-workspace Plugins action.
     * Optional (absent in tests that don't exercise plugins).
     */
    plugins?: PluginsStore;
    /**
     * The layout port (plan 04 §4.4): forwarded to the per-workspace plugins
     * modal's "Reset layout to default" affordance. Absent → the modal's
     * layout section doesn't render.
     */
    layout?: WorkspaceLayoutPort;
    /**
     * The persisted tile layout store. Absent → created here over the real
     * localStorage adapter (the page is the effect edge); tests inject one.
     */
    tiles?: TileLayoutStore;
  } = $props();

  onMount(() => {
    void store.refresh();
  });

  // ── The persisted tile layout (order + spans only — never positions). ─────
  // The store is created once per page from the (inert) override prop — the
  // repo's `untrack` pattern for initial-value captures (cf. App.svelte).
  const tiles: TileLayoutStore =
    untrack(() => tilesOverride) ??
    createTileLayoutStore(
      createLocalStore(TILE_LAYOUT_STORAGE_KEY, {
        storage: typeof localStorage !== "undefined" ? localStorage : undefined,
      }),
    );

  // Keep the layout merged with the live workspace list: unknown workspaces
  // (deep-link auto-creates) append at the end; deleted ones drop. The no-op
  // guard inside sync keeps this effect from looping. Skipped until the first
  // non-empty list arrives — `sync([])` before the initial `refresh()` resolves
  // would WIPE the persisted order (the backend always serves "default", so an
  // empty list only ever means "not loaded yet").
  $effect(() => {
    const ids = store.list.map((ws) => ws.id);
    if (ids.length === 0) return;
    tiles.sync(ids);
  });

  // ── The tile canvas' size decides the geometry (ONE pure function — no
  // breakpoint classes). Unmeasured (tests) → the default landscape viewport.
  let regionEl = $state<HTMLDivElement | undefined>();
  let size = $state<{ width: number; height: number } | undefined>();
  const geometry: GridGeometry = $derived(
    geometryFor(size?.width ?? DEFAULT_VIEWPORT.width, size?.height ?? DEFAULT_VIEWPORT.height),
  );

  $effect(() => {
    const el = regionEl;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) size = { width: rect.width, height: rect.height };
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

  // The grid view: the SAME persisted data packs into either geometry —
  // positions re-derive here, spans clamp for the RENDER only.
  const placements = $derived(pack(tiles.entries, geometry));
  const workspacesById = $derived(new Map(store.list.map((ws) => [ws.id, ws])));

  // ── Selection + action bar ─────────────────────────────────────────────────
  let selectedId = $state<string | null>(null);
  const selected = $derived(selectedId !== null ? (workspacesById.get(selectedId) ?? null) : null);

  function select(id: string): void {
    selectedId = id;
  }

  function deselect(): void {
    selectedId = null;
  }

  // ── Rename mode (the create flow + the action bar's Rename action) ────────
  let renamingId = $state<string | null>(null);

  // ── Resize picker (transient ghost preview; commit persists) ──────────────
  let resizing = $state<{ id: string; span: Span | null } | null>(null);
  const resizingEntry = $derived(
    resizing ? (tiles.entries.find((tile) => tile.id === resizing?.id) ?? null) : null,
  );

  function startResize(): void {
    if (!selected) return;
    const entry = tiles.entries.find((tile) => tile.id === selected.id);
    resizing = {
      id: selected.id,
      span: entry
        ? { colSpan: entry.colSpan, rowSpan: entry.rowSpan }
        : { colSpan: 1, rowSpan: 1 },
    };
  }

  function commitResize(colSpan: number, rowSpan: number): void {
    if (!resizing) return;
    tiles.resize(resizing.id, colSpan, rowSpan);
    resizing = null;
  }

  function cancelResize(): void {
    resizing = null;
  }

  // ── Details flyout (the dense per-card settings). Id-based + gated on the
  // selection, so deselecting (Escape) also dismisses it. ─────────────────────
  let detailsForId = $state<string | null>(null);
  const detailsFor = $derived(
    selectedId !== null && detailsForId === selectedId
      ? (workspacesById.get(selectedId) ?? null)
      : null,
  );

  // ── Per-workspace plugin modal ─────────────────────────────────────────────
  let pluginsModalId = $state<string | null>(null);
  const pluginsModalFor = $derived(
    pluginsModalId !== null ? (workspacesById.get(pluginsModalId) ?? null) : null,
  );

  // Global plugin manager modal (plan 07 §7.2): the ONLY surface that
  // loads/unloads code (strict layering).
  let managerOpen = $state(false);

  // ── Actions (the action bar) ───────────────────────────────────────────────
  function openWorkspace(id: string): void {
    deselect();
    onNavigate(workspacePath(id));
  }

  async function deleteSelected(): Promise<void> {
    if (!selected) return;
    const ws = selected;
    if (
      !window.confirm(
        `Delete workspace "${ws.title}"? Its conversations will be closed and moved to "default".`,
      )
    ) {
      return;
    }
    const result = await store.remove(ws.id);
    if (result.ok) deselect();
  }

  async function toggleStar(): Promise<void> {
    if (!selected) return;
    await store.setStarred(selected.id, !selected.starred);
  }

  // ── Create (header popover): create on the backend — do NOT navigate —
  // place the new tile in the first empty slot, and go straight into rename.
  async function createWorkspace(
    slug: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const result = await store.ensure(slug);
    if (!result.ok) return { ok: false, error: result.error };
    await store.refresh();
    // Idempotent: if the list refresh's sync already appended the id, this
    // MOVES it into the first empty slot instead of duplicating.
    tiles.placeFirstEmpty(slug, geometry);
    renamingId = slug;
    return { ok: true };
  }

  // ── Sort overflow: re-apply the recent-activity order ──────────────────────
  function sortByRecent(): void {
    const activity = new Map(store.list.map((ws) => [ws.id, ws.lastActivityAt]));
    tiles.sortByRecentActivity(activity);
  }

  // Escape unwinds the overlays: resize → selection.
  function handleKeydown(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    if (resizing) {
      cancelResize();
    } else if (selectedId !== null) {
      deselect();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-screen w-full flex-col">
  <HomeHeader
    compact={geometry.mode === "tall"}
    withPlugins={plugins !== undefined}
    withSort={store.list.length > 1}
    onCreate={createWorkspace}
    onOpenPlugins={() => (managerOpen = true)}
    onSort={() => void sortByRecent()}
  />

  <div bind:this={regionEl} class="min-h-0 w-full flex-1">
    {#if store.loading && store.list.length === 0}
      <div class="flex h-32 items-center justify-center">
        <span class="loading loading-spinner loading-sm opacity-60"></span>
      </div>
    {:else if store.list.length === 0}
      <p class="py-8 text-center text-sm opacity-60">
        No workspaces yet. Create one with <strong>New workspace</strong> above, or visit
        <code>/your-name</code> in the URL.
      </p>
    {:else}
      <HomeTileGrid
        {geometry}
        {placements}
        {workspacesById}
        {store}
        {selectedId}
        {renamingId}
        preview={
          resizing?.id !== undefined && resizing.span !== null
            ? { id: resizing.id, ...resizing.span }
            : null
        }
        {...(hasActive ? { hasActive } : {})}
        onOpen={openWorkspace}
        onSelect={select}
        onReorder={(id, toIndex) => tiles.move(id, toIndex)}
        onRenameEnd={() => (renamingId = null)}
      />
    {/if}
  </div>
</div>

{#if selected && !renamingId}
  <TileActionBar
    ws={selected}
    withPlugins={plugins !== undefined}
    onOpen={() => openWorkspace(selected.id)}
    onRename={() => (renamingId = selected.id)}
    onResize={startResize}
    onToggleStar={() => void toggleStar()}
    onDetails={() => (detailsForId = selected.id)}
    onPlugins={() => (pluginsModalId = selected.id)}
    onDelete={() => void deleteSelected()}
    onClose={deselect}
  />
{/if}

{#if resizing && resizingEntry}
  <ResizePicker
    {geometry}
    initial={{ colSpan: resizingEntry.colSpan, rowSpan: resizingEntry.rowSpan }}
    onPreview={(span) => {
      if (resizing) resizing = { id: resizing.id, span };
    }}
    onCommit={commitResize}
    onCancel={cancelResize}
  />
{/if}

{#if detailsFor}
  <WorkspaceDetails ws={detailsFor} {store} {computers} onClose={() => (detailsForId = null)} />
{/if}

{#if pluginsModalFor && plugins}
  <WorkspacePluginModal
    workspaceId={pluginsModalFor.id}
    workspaceTitle={pluginsModalFor.title}
    {plugins}
    {...(layout ? { layout } : {})}
    onClose={() => (pluginsModalId = null)}
  />
{/if}

{#if managerOpen && plugins}
  <PluginManager {plugins} onClose={() => (managerOpen = false)} />
{/if}
