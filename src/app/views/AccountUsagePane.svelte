<script lang="ts">
  /**
   * The `account-usage` view — Claude + Codex subscription usage bars with
   * on-track pace markers. GLOBAL (not workspace/conversation scoped), so it
   * stays mounted across tab switches (no {#key}).
   */
  import { AccountUsageView, type LoadAccountUsage } from "../../features/account-usage";
  import type { AppViewPorts } from "../view-ports";

  let { ports }: { ports: AppViewPorts } = $props();
  const store = $derived(ports.store);

  const loadAccountUsage: LoadAccountUsage = (opts) => store.accountUsage(opts);
</script>

<AccountUsageView load={loadAccountUsage} />
