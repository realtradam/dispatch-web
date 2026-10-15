<script module lang="ts">
  import { registerBuiltinViews } from "./register-views";

  // Register every built-in view ONCE per app load, BEFORE any tile renders.
  // The composition root stays the only place store ports are wired: the
  // wrappers receive them through `ports` (see `view-ports.ts`).
  registerBuiltinViews();
</script>

<script lang="ts">
  import type { LayoutTree } from "@dispatch/layout-contract";
  import { untrack } from "svelte";
  import { createCollapseStore, firstCollapsibleNodeId, TileRoot } from "../features/layout";
  import { RunModal, type HeartbeatRunView } from "../features/heartbeat";
  import { SystemPromptBuilder } from "../features/system-prompt";
  import type { AppStore } from "./store.svelte";
  import type { AppViewPorts, ChatViewportBridge } from "./view-ports";
  import ErrorModal from "./ErrorModal.svelte";

  let { store, onNavigate }: { store: AppStore; onNavigate: (path: string) => void } = $props();

  // Modal chrome — app shell state, OUTSIDE the tree (layout-00 decision 2).
  let systemPromptModalOpen = $state(false);
  // The heartbeat run currently open in the fullscreen run-chat modal (null =
  // closed). Holds a snapshot run view; the modal re-mounts per run (keyed).
  let heartbeatRun = $state<HeartbeatRunView | null>(null);

  // --- The layout tree (plan 02): the ACTIVE workspace's tile tree, served
  // by the backend's layout provider plugin when one is active (probed on
  // boot, on workspace switch, and on extensions-changed; `layout` WS pushes
  // re-render live) and the built-in DEFAULT_LAYOUT otherwise (no-provider
  // mode: edits are ephemeral, logged once, no error UI). The store owns the
  // whole lifecycle; the shell just renders `tree` and forwards edits.
  // `dispatch.sidebar.views` is RETIRED (D-L4): its only reader is the store's
  // one-way §2.7 migration.
  const tree = $derived(store.layout.tree);

  function handleTreeChange(next: LayoutTree): void {
    store.layout.onTreeChange(next);
  }

  // --- Sidebar collapse: renderer chrome state (per-node-id open/closed),
  // persisted with the SAME key/semantics as today (`dispatch.sidebar.open`, a
  // bare boolean, default open on wide screens). The toggle drives the tree's
  // single collapsible node ("side" on the default tree; generically the first
  // collapsible split child).
  const collapse = createCollapseStore({
    storage: untrack(() => store.storage),
    viewportWidth: typeof window !== "undefined" ? window.innerWidth : undefined,
  });
  const collapseState = $derived($collapse);
  const collapseKey = $derived(firstCollapsibleNodeId(tree));
  const sidebarOpen = $derived(
    collapseKey !== null ? (collapseState.openByNode[collapseKey] ?? collapseState.defaultOpen) : false,
  );

  function toggleSidebar(): void {
    if (collapseKey !== null) collapse.toggle(collapseKey);
  }

  // --- The port bag every view wrapper receives. This is the ONE place the
  // store's ports are wired (AGENTS.md: composition root). `store` is read
  // through a getter so a swapped store prop stays reactive through it.
  const chatViewport: ChatViewportBridge = { el: null };
  const viewPorts: AppViewPorts = {
    get store() {
      return store;
    },
    chatViewport,
    openSystemPromptBuilder: () => (systemPromptModalOpen = true),
    openHeartbeatRun: (run) => (heartbeatRun = run),
  };

  // Top-bar title: the active tab's title, or "New Tab" when no tab is active
  // (a fresh, unstarted draft — the conversation hasn't been sent yet, so no
  // tab exists). Pure-derived from the (workspace-filtered) tab set + the
  // active id; reflects whichever tab is selected in the sidebar's Tabs view.
  const NEW_TAB_TITLE = "New Tab";
  const topBarTitle = $derived.by(() => {
    const id = store.activeConversationId;
    if (id === null) return NEW_TAB_TITLE;
    const tab = store.tabs.find((t) => t.conversationId === id);
    return tab?.title ?? NEW_TAB_TITLE;
  });

  function handleInvokeHome(): void {
    onNavigate("/");
  }
</script>

<main class="relative flex h-screen flex-col overflow-hidden">
  <!-- Slim header: the tab bar moved into the sidebar (the "Tabs" view), so
       the top row now shows the active tab's title on the left (or "New Tab"
       for an unstarted draft), with the build version + sidebar toggle on
       the right. CHROME — stays outside the tree (layout-00 decision 2).
       `.app-navbar` (below): the Artix wiki's darkstrap navbar look. -->
  <div class="app-navbar flex items-center justify-between gap-2 px-2 py-2">
    <span
      class="min-w-0 flex-1 shrink truncate pl-2 text-sm font-semibold text-primary"
      data-testid="top-bar-title"
      title={topBarTitle}
      aria-label="Active conversation title"
    >
      {topBarTitle}
    </span>
    <span
      class="shrink-0 select-none px-1 font-mono text-[10px] leading-none text-primary/70"
      title="Build version (git short hash)"
    >
      build: {__APP_VERSION__}
    </span>
    <a
      href="/"
      class="btn btn-ghost btn-sm shrink-0 px-2 text-primary"
      aria-label="Back to dashboard"
      title="Back to dashboard"
      onclick={(e) => {
        e.preventDefault();
        handleInvokeHome();
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="2"
        stroke="currentColor"
        class="size-4"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.5a.75.75 0 0 0 .75.75h4.5a.75.75 0 0 0 .75-.75V15a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75v5.25a.75.75 0 0 0 .75.75h4.5a.75.75 0 0 0 .75-.75V9.75M8.25 21h8.25"
        />
      </svg>
    </a>
    {#if collapseKey !== null}
      <button
        class="btn btn-square btn-ghost btn-sm mx-1 shrink-0 text-primary"
        aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        aria-expanded={sidebarOpen}
        onclick={toggleSidebar}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2"
          stroke="currentColor"
          class="size-5"
          aria-hidden="true"
        >
          {#if sidebarOpen}
            <!-- Sidebar open → chevrons point right -->
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="m11.25 4.5 7.5 7.5-7.5 7.5m-7.5-15 7.5 7.5-7.5 7.5"
            />
          {:else}
            <!-- Sidebar closed → chevrons point left -->
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5"
            />
          {/if}
        </svg>
      </button>
    {/if}
  </div>

  {#if store.lastError}
    <div role="alert" class="alert alert-error mx-4 mt-2">
      <strong>Error:</strong>
      {store.lastError.message}
    </div>
  {/if}

  {#if store.activeChat.error}
    <div role="alert" class="alert alert-warning mx-4 mt-2">
      <strong>Chat error:</strong>
      {store.activeChat.error}
    </div>
  {/if}

  <!-- THE TREE: the tile renderer owns the content region. Tile edits are
       applied here and persisted to dispatch.sidebar.views (above). -->
  <div class="min-h-0 min-w-0 flex-1">
    <TileRoot {tree} {collapse} ports={viewPorts} onTreeChange={handleTreeChange} />
  </div>
</main>

{#if store.fatalError}
  <ErrorModal error={store.fatalError} onDismiss={() => store.clearFatalError()} />
{/if}

{#if systemPromptModalOpen}
  <SystemPromptBuilder
    loadPrompt={() => store.loadSystemPrompt()}
    savePrompt={(template) => store.setSystemPrompt(template)}
    loadVariables={() => store.loadSystemPromptVariables()}
    onClose={() => (systemPromptModalOpen = false)}
  />
{/if}

{#if heartbeatRun !== null}
  <!-- Keyed per run so switching runs (or re-opening) re-mounts the modal — a
       fresh watch store lifecycle per run. The modal owns the live watch
       (openChat/closeChat) and the Stop button. -->
  {#key heartbeatRun.id}
    <RunModal
      run={heartbeatRun}
      openChat={(conversationId) => store.watchConversation(conversationId)}
      closeChat={(conversationId) => store.unwatchConversation(conversationId)}
      stopRun={(runId) => store.stopHeartbeatRun(runId)}
      onClose={() => (heartbeatRun = null)}
      apiBaseUrl={store.httpBase}
    />
  {/key}
{/if}

<style>
  /* The Artix wiki's navbar (darkstrap `.navbar-inner` on a fixed-top bar):
     a top-to-bottom gradient (#444 → #222), a 1px near-black bottom border
     (#030303), a soft drop shadow under the bar (0 1px 10px), and text
     engraved with a 1px black text-shadow. Ported onto the active daisyUI
     theme so it always matches. darkstrap's bar is LIGHTER than its near-black
     page (that's what makes the border + shadow read), so the gradient is
     shifted to keep that relationship on our lighter page: it runs from the
     page colour (base-100) lifted 20% toward the text colour down to base-100
     lifted 3%; the border is base-100 darkened 90%. The shadow is 0.5
     (darkstrap: 0.1 — invisible on our lighter page).
     Positioned + z-indexed so the shadow paints over the content below. */
  .app-navbar {
    position: relative;
    z-index: 10;
    flex-shrink: 0;
    padding-top: calc(0.5rem + 5px);
    background-image: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--color-base-100) 80%, var(--color-base-content)),
      color-mix(in srgb, var(--color-base-100) 97%, var(--color-base-content))
    );
    border-bottom: 1px solid color-mix(in srgb, var(--color-base-100) 10%, black);
    box-shadow: 0 1px 10px rgb(0 0 0 / 0.5);
  }
  /* Engraved text — the title only; on the tiny faint build label it muddies. */
  .app-navbar :global([data-testid="top-bar-title"]) {
    text-shadow: 0 1px 0 black;
  }
</style>
