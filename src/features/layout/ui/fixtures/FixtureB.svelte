<script lang="ts">
  // A fixture view for renderer tests — ignores any props it receives.
  let { label = "Beta" }: { label?: string } = $props();
</script>

<div data-testid="fixture-b">{label}</div>
