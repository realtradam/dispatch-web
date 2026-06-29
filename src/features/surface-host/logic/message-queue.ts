import type { QueuedMessage } from "@dispatch/wire";

/**
 * Pure parser for the `rendererId: "message-queue"` custom-field payload.
 *
 * The message-queue extension's per-conversation surface emits ONE `custom`
 * field with `rendererId: "message-queue"` and `payload: QueuePayload`
 * (`{ messages: QueuedMessage[] }` — the current queue snapshot). This parser
 * validates the untyped `payload: unknown` at the network seam so a
 * hostile/partial payload can never crash the renderer (graceful skip → null).
 *
 * Empty `messages` is a valid, parseable state (the queue is empty — nothing to
 * render); the caller hides the panel. Null is returned only for a malformed
 * payload shape.
 */
export interface MessageQueueData {
  readonly messages: readonly QueuedMessage[];
}

function isQueuedMessage(v: unknown): v is QueuedMessage {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.text === "string" &&
    typeof o.queuedAt === "number" &&
    Number.isFinite(o.queuedAt)
  );
}

export function parseMessageQueuePayload(payload: unknown): MessageQueueData | null {
  if (typeof payload !== "object" || payload === null) return null;
  const obj = payload as Record<string, unknown>;
  const raw = obj.messages;
  if (!Array.isArray(raw)) return null;
  const messages: QueuedMessage[] = [];
  for (const entry of raw) {
    if (!isQueuedMessage(entry)) return null;
    messages.push(entry);
  }
  return { messages };
}

/** The `rendererId` the message-queue extension's `custom` surface field uses. */
export const MESSAGE_QUEUE_RENDERER_ID = "message-queue";

/**
 * Optimistic-removal view-model for the queue list.
 *
 * The `chat.queue.cancel` op is fire-and-forget + idempotent: success is
 * confirmed by the `message-queue` SURFACE updating (the cancelled message
 * leaves the snapshot), not by a reply. To avoid a flash of the row lingering
 * for a round-trip, the renderer hides a row the instant the user clicks cancel
 * (tracking the cancelled id locally), then reconciles when the surface pushes
 * the post-cancel snapshot. These two pure helpers drive that — the component
 * holds the cancelled-id set as a thin `$state` wrapper and delegates all
 * decisions here.
 */

/**
 * The messages the renderer should show: the surface snapshot MINUS any
 * optimistically-cancelled ids (a cancel whose surface confirmation hasn't
 * arrived yet). Pure — no mutation of inputs.
 */
export function selectVisibleMessages(
  messages: readonly QueuedMessage[],
  cancelledIds: ReadonlySet<string>,
): readonly QueuedMessage[] {
  if (cancelledIds.size === 0) return messages;
  return messages.filter((m) => !cancelledIds.has(m.id));
}

/**
 * Reconcile the cancelled-id set against a NEW surface snapshot: keep only the
 * ids that are STILL queued (the cancel is pending — its surface confirmation
 * hasn't landed). Drop ids that have left the snapshot: the server confirmed
 * the removal (or the message drained as steering / the queue cleared), so the
 * optimistic hide is no longer needed. This keeps the set bounded — it never
 * outlives the rows it tracks. Pure — returns a NEW set (callers assign it to
 * the reactive `$state`).
 */
export function reconcileCancelledIds(
  messages: readonly QueuedMessage[],
  cancelledIds: ReadonlySet<string>,
): ReadonlySet<string> {
  if (cancelledIds.size === 0) return EMPTY_STRING_SET;
  const stillQueued = new Set<string>();
  for (const m of messages) {
    if (cancelledIds.has(m.id)) stillQueued.add(m.id);
  }
  // Same set back → return the input identity so the component's `$state` setter
  // sees no change (avoids a spurious reactive cycle).
  if (stillQueued.size === cancelledIds.size) {
    let same = true;
    for (const id of cancelledIds) {
      if (!stillQueued.has(id)) {
        same = false;
        break;
      }
    }
    if (same) return cancelledIds;
  }
  return stillQueued;
}

const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>();
