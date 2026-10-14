<script lang="ts">
  import { untrack } from "svelte";
  import type { AccountUsageReport, SaveAccountUsageSettings } from "../logic/types";
  import {
    anchorFromTimeOfDay,
    type DailyCreditsView,
    parseAllowanceInput,
  } from "../logic/view-model";

  let {
    daily,
    save,
    onSaved,
    now = () => Date.now(),
  }: {
    daily: DailyCreditsView;
    save: SaveAccountUsageSettings;
    /** Receives the refreshed report after a successful save. */
    onSaved: (report: AccountUsageReport) => void;
    now?: () => number;
  } = $props();

  let editing = $state(false);
  let allowanceInput = $state("");
  let timeInput = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);

  const parsedAllowance = $derived(parseAllowanceInput(allowanceInput));
  const timeValid = $derived(timeInput === "" || anchorFromTimeOfDay(timeInput, now()) !== null);

  function startEdit(): void {
    untrack(() => {
      allowanceInput = String(daily.allowance);
      timeInput = daily.resetTime;
    });
    error = null;
    editing = true;
  }

  async function submit(): Promise<void> {
    if (parsedAllowance === null || !timeValid) return;
    saving = true;
    error = null;
    // Empty time clears a MANUAL anchor (a detected one may still apply).
    const resetAnchor = timeInput === "" ? null : anchorFromTimeOfDay(timeInput, now());
    const result = await save("hyper", { dailyAllowance: parsedAllowance, resetAnchor });
    saving = false;
    if (result.ok) {
      editing = false;
      onSaved(result.report);
    } else {
      error = result.error;
    }
  }
</script>

<div class="flex flex-col gap-1 text-[11px]">
  <div class="flex items-center justify-between gap-2">
    <span class="opacity-70">{daily.balanceLabel}</span>
    {#if !editing}
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        onclick={startEdit}
        aria-label="Edit Hyper credit settings">Edit</button
      >
    {/if}
  </div>
  {#if !editing}
    <span class="opacity-60">
      Daily allowance {daily.allowance} · resets {daily.resetTime || "—"} ({daily.resetSourceLabel})
    </span>
  {:else}
    <form
      class="flex flex-col gap-1"
      onsubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label class="flex items-center justify-between gap-2">
        <span>Daily allowance</span>
        <input
          type="text"
          inputmode="numeric"
          class="input input-bordered input-xs w-20 font-mono"
          class:input-error={parsedAllowance === null}
          aria-label="Daily credit allowance"
          bind:value={allowanceInput}
          disabled={saving}
        />
      </label>
      <label class="flex items-center justify-between gap-2">
        <span>Reset time (local)</span>
        <input
          type="time"
          class="input input-bordered input-xs w-24 font-mono"
          class:input-error={!timeValid}
          aria-label="Daily credit reset time"
          bind:value={timeInput}
          disabled={saving}
        />
      </label>
      <span class="opacity-50">Leave the time empty to use the auto-detected refill time.</span>
      {#if error}<span class="text-error">{error}</span>{/if}
      <div class="flex justify-end gap-1">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={() => (editing = false)}
          disabled={saving}>Cancel</button
        >
        <button
          type="submit"
          class="btn btn-primary btn-xs"
          disabled={saving || parsedAllowance === null || !timeValid}
          aria-label="Save Hyper credit settings"
        >
          {#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
          Save
        </button>
      </div>
    </form>
  {/if}
</div>
