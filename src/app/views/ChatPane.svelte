<script lang="ts">
  /**
   * The `chat` view — the transcript region that moved out of App.svelte with
   * ALL of its coupling: the smart-scroll controller (created here, reset on
   * conversation switch like today's reset effect), the unload-gate attach
   * effect, the follow-bottom effect, "show earlier" with viewport
   * preservation, the ScrollToBottom affordance, and the empty-state
   * watermark. Keyed on the active conversation exactly like today's ChatView.
   */
  import { ChatView } from "../../features/chat";
  import { createSmartScrollController, ScrollToBottom } from "../../features/smart-scroll";
  import { preserveViewportAcross, type AppViewPorts } from "../view-ports";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  // One controller owns the chat scroll region; the effects below feed it the
  // edges (identical to the App.svelte wiring this moved out of).
  const smartScroll = createSmartScrollController();
  let transcriptEl = $state<HTMLElement | undefined>();
  let transcriptContentEl = $state<HTMLElement | undefined>();

  // The settings view's chat-limit save preserves the reader's viewport over
  // the history refill — share the live scroll element through the bridge.
  $effect(() => {
    ports.chatViewport.el = transcriptEl ?? null;
  });

  // Chat-limit unload gate: old chunks may be unloaded only while the reader is
  // stuck to the bottom. While stuck, a trim removes content far ABOVE the
  // viewport and the controller re-pins to the bottom — no visible jump; while
  // reading history, trimming is deferred instead of yanking the page (the old
  // Dispatch bug). In an $effect so a swapped store prop would be re-wired.
  $effect(() => {
    store.attachUnloadGate(() => smartScroll.isAtBottom());
  });

  // "Show earlier messages": page older history back in, preserving the reader's
  // viewport position.
  async function handleShowEarlier(): Promise<void> {
    await preserveViewportAcross(transcriptEl, () => store.activeChat.showEarlier());
  }

  // Attach/detach the controller to the live scroll element + content (disposed
  // on unmount). The content element is observed (ResizeObserver) so the view
  // follows height changes that aren't a transcript append.
  $effect(() => {
    if (!transcriptEl) return;
    return smartScroll.attach(transcriptEl, transcriptContentEl);
  });

  // New transcript content streamed in (or messages loaded) → follow the bottom
  // while stuck. Reads `chunks.length` so the effect re-runs on every append.
  $effect(() => {
    void store.activeChat.chunks.length;
    smartScroll.contentChanged();
  });

  // Conversation/tab switch → snap to the bottom of the new transcript.
  $effect(() => {
    void store.activeConversationId;
    smartScroll.reset();
  });
</script>

<div class="relative h-full">
  <!-- The right gutter lives INSIDE the scroller (on the content), not outside
       it: overlay scrollbars (iOS/iPadOS WebKit — Safari, Vivaldi, …; macOS)
       take no layout space and paint over the scroller's right edge, so with
       the gutter outside they drew on top of the tool/thinking cards. Now the
       scroller spans to the pane edge and its scrollbar sits in the empty
       gutter, clear of the content (classic scrollbars likewise). -->
  <div bind:this={transcriptEl} class="h-full overflow-y-auto">
    <div bind:this={transcriptContentEl} class="pr-4">
      {#key store.activeConversationId}
        <ChatView
          chunks={store.activeChat.chunks}
          turnMetrics={store.activeChat.turnMetrics}
          hasEarlier={store.activeChat.hasEarlier}
          onShowEarlier={handleShowEarlier}
          thinkingKeyBase={store.activeChat.thinkingKeyBase}
          providerRetry={store.activeChat.providerRetry}
          apiBaseUrl={store.httpBase}
        />
      {/key}
    </div>
  </div>
  {#if store.activeChat.chunks.length === 0}
    <div
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
      aria-hidden="true"
    >
      <span class="select-none text-4xl font-bold opacity-10">Dispatch</span>
    </div>
  {/if}
  <ScrollToBottom show={smartScroll.showButton} onResume={() => smartScroll.resume()} />
</div>
