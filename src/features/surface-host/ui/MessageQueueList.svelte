<script lang="ts">
  import {
    parseMessageQueuePayload,
    reconcileCancelledIds,
    selectVisibleMessages,
  } from "../logic/message-queue";

  let {
    payload,
    onCancel,
  }: {
    readonly payload: unknown;
    /**
     * Cancel (remove) a single queued message by id (`chat.queue.cancel`).
     * Required-but-nullable (not optional) so a parent can thread a
     * `| undefined` callback through under `exactOptionalPropertyTypes`:
     * `undefined` → a read-only list (no × affordance), e.g. a generic surface
     * context with no conversation scope. The list still reconciles from the
     * surface either way.
     */
    readonly onCancel: ((messageId: string) => void) | undefined;
  } = $props();

  // Parse defensively; an unparseable payload yields null → render nothing
  // (graceful skip, per the custom-field contract).
  const data = $derived(parseMessageQueuePayload(payload));

  // Optimistic-removal: a cancelled id is hidden the instant the user clicks,
  // ahead of the surface's post-cancel snapshot. Reconcile on every payload
  // change so a confirmed-removed id (no longer in the snapshot) is dropped
  // from the set — keeping it bounded (pure helpers in logic/message-queue).
  let cancelledIds = $state<ReadonlySet<string>>(new Set());

  $effect(() => {
    const parsed = data;
    if (parsed === null) return;
    const next = reconcileCancelledIds(parsed.messages, cancelledIds);
    if (next !== cancelledIds) cancelledIds = next;
  });

  const visible = $derived(
    data === null ? [] : selectVisibleMessages(data.messages, cancelledIds),
  );

  function handleCancel(messageId: string): void {
    // Optimistically hide the row + fire the cancel (fire-and-forget; the
    // surface update reconciles). Idempotent server-side, so a double-click or
    // a cancel of an already-drained message is a silent no-op — no rollback.
    if (cancelledIds.has(messageId)) return;
    const next = new Set(cancelledIds);
    next.add(messageId);
    cancelledIds = next;
    onCancel?.(messageId);
  }
</script>

{#if data !== null && data.messages.length > 0}
  <ul class="flex flex-col gap-1 text-sm">
    {#each visible as msg (msg.id)}
      <li class="flex items-start gap-2 rounded-box bg-base-200 px-3 py-2">
        <div class="min-w-0 flex-1">
          <p class="whitespace-pre-wrap break-words">{msg.text}</p>
          <time class="text-xs opacity-50" datetime={new Date(msg.queuedAt).toISOString()}>
            {new Date(msg.queuedAt).toLocaleTimeString()}
          </time>
        </div>
        {#if onCancel !== undefined}
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square shrink-0 opacity-60 hover:opacity-100"
            title="Cancel this queued message"
            aria-label="Cancel this queued message"
            onclick={() => handleCancel(msg.id)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-3.5 w-3.5"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
