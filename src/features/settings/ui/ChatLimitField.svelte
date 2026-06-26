<script lang="ts">
  import { untrack } from "svelte";
  import { MAX_CHAT_LIMIT, MIN_CHAT_LIMIT } from "../../../core/chunks";
  import { chatLimitChanged, parseChatLimit, type SaveChatLimit } from "../logic/view-model";

  let {
    chatLimit,
    save,
  }: {
    /** The persisted chat limit (max loaded chunks per conversation). */
    chatLimit: number;
    save: SaveChatLimit;
  } = $props();

  // Seed from the prop; the $effect below re-seeds on external changes (a live
  // apply from elsewhere) but only while the field is untouched, so an in-flight
  // change can't clobber what the user typed.
  let value = $state("");
  let lastSeed = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);
  let justSaved = $state(false);
  let savedValue = $state<number | null>(null);

  $effect(() => {
    const incoming = String(chatLimit);
    untrack(() => {
      if (value === lastSeed) value = incoming;
      lastSeed = incoming;
    });
  });

  const dirty = $derived(chatLimitChanged(value, chatLimit));

  async function handleSave() {
    if (saving || !dirty) return;
    const parsed = parseChatLimit(value);
    if (!parsed.ok) {
      error = parsed.error;
      return;
    }
    saving = true;
    error = null;
    justSaved = false;
    const result = await save(parsed.value);
    saving = false;
    if (result.ok) {
      justSaved = true;
      savedValue = result.chatLimit;
      // Reflect the clamped / persisted value back into the input immediately
      // (the prop will also re-assert it via the effect above).
      value = String(result.chatLimit);
      lastSeed = value;
    } else {
      error = result.error;
    }
  }

  function onInput() {
    justSaved = false;
    error = null;
  }
</script>

<div class="flex flex-col gap-1">
  <span class="text-xs font-semibold uppercase opacity-60">Chat limit</span>
  <div class="flex items-center gap-2">
    <input
      type="text"
      inputmode="numeric"
      class="input input-bordered input-sm w-full font-mono text-xs"
      placeholder={String(chatLimit)}
      bind:value
      disabled={saving}
      oninput={onInput}
      onkeydown={(e) => {
        if (e.key === "Enter") handleSave();
      }}
      aria-label="Chat limit"
    />
    <button
      type="button"
      class="btn btn-primary btn-sm"
      disabled={saving || !dirty}
      onclick={handleSave}
    >
      {#if saving}
        <span class="loading loading-spinner loading-xs"></span>
      {:else}
        Set
      {/if}
    </button>
  </div>
  {#if error}
    <p class="text-xs text-error">{error}</p>
  {:else if justSaved && !dirty}
    <p class="text-xs text-success">Saved{savedValue !== null ? `: ${savedValue}.` : "."}</p>
  {:else}
    <p class="text-xs opacity-50">
      Max loaded chunks per conversation ({MIN_CHAT_LIMIT}–{MAX_CHAT_LIMIT}). Lowering it unloads
      older history; raise it and use "Show earlier" to page back in.
    </p>
  {/if}
</div>
