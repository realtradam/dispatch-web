<script lang="ts">
  // A fixture view for renderer tests — ignores any props it receives.
  let { label = "Alpha" }: { label?: string } = $props();
</script>

<div data-testid="fixture-a">{label}</div>
