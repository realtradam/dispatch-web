<script lang="ts">
  /**
   * The `concurrency` view — per-provider concurrency limits + live status.
   * GLOBAL (not workspace- or conversation-scoped), so the panel stays mounted
   * across tab switches (no {#key}, like today).
   */
  import {
    ConcurrencyView,
    type DeleteConcurrencyLimit,
    type LoadConcurrencyLimits,
    type LoadConcurrencyStatus,
    type SaveConcurrencyCooldown,
    type SaveConcurrencyLimit,
  } from "../../features/concurrency";
  import type { AppViewPorts } from "../view-ports";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  // Thin passthroughs (kept for structural consistency — AGENTS.md "contracts
  // are the cross-unit surface").
  const loadConcurrencyLimits: LoadConcurrencyLimits = () => store.concurrencyLimits();
  const saveConcurrencyLimit: SaveConcurrencyLimit = (providerId, limit) =>
    store.setConcurrencyLimit(providerId, limit);
  const deleteConcurrencyLimit: DeleteConcurrencyLimit = (providerId) =>
    store.deleteConcurrencyLimit(providerId);
  const loadConcurrencyStatus: LoadConcurrencyStatus = () => store.concurrencyStatus();
  const saveConcurrencyCooldown: SaveConcurrencyCooldown = (providerId, cooldownMs) =>
    store.setConcurrencyCooldown(providerId, cooldownMs);
</script>

<ConcurrencyView
  models={store.models}
  loadLimits={loadConcurrencyLimits}
  saveLimit={saveConcurrencyLimit}
  deleteLimit={deleteConcurrencyLimit}
  loadStatus={loadConcurrencyStatus}
  saveCooldown={saveConcurrencyCooldown}
/>
