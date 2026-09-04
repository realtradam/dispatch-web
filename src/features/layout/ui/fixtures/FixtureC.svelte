<script lang="ts">
  // A fixture view for renderer tests — ignores any props it receives.
  let { label = "Gamma" }: { label?: string } = $props();
</script>

<div data-testid="fixture-c">{label}</div>
