<script lang="ts">
  /**
   * The `vision` view — global vision settings (image-compaction limit +
   * model) with the store adapters. Not conversation-scoped (no {#key}), so
   * the settings stay mounted across tab switches (like today).
   */
  import {
    VisionSettingsView,
    type LoadVisionSettingsResult,
    type SaveVisionSettingsResult,
    type VisionSettingsPatch,
  } from "../../features/vision";
  import type { AppViewPorts } from "../view-ports";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  // Adapt the store's global vision-settings API to the vision feature's ports.
  async function loadVisionSettings(): Promise<LoadVisionSettingsResult> {
    // The store seeds `visionSettings` on boot; a refresh keeps it current.
    await store.refreshVisionSettings();
    const settings = store.visionSettings;
    if (settings === null) {
      return { ok: false, error: "Vision settings not available." };
    }
    return { ok: true, settings };
  }

  async function saveVisionSettings(
    patch: VisionSettingsPatch,
  ): Promise<SaveVisionSettingsResult> {
    const result = await store.setVisionSettings(patch);
    if (result === null) return { ok: false, error: "Vision settings not available." };
    return result.ok
      ? { ok: true, settings: result.settings }
      : { ok: false, error: result.error };
  }
</script>

<VisionSettingsView
  models={store.models}
  modelInfo={store.modelInfo}
  load={loadVisionSettings}
  save={saveVisionSettings}
/>
