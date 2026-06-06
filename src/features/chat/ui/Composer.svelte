<script lang="ts">
	let { onSend }: { onSend: (text: string) => void } = $props();

	let text = $state("");

	function handleSubmit(): void {
		const trimmed = text.trim();
		if (trimmed.length === 0) return;
		onSend(trimmed);
		text = "";
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}
</script>

<form class="composer" onsubmit={prevent => { prevent.preventDefault(); handleSubmit(); }}>
	<textarea
		class="composer__input"
		bind:value={text}
		onkeydown={handleKeydown}
		placeholder="Type a message..."
		rows="3"
		aria-label="Message input"
	></textarea>
	<button class="composer__send" type="submit" disabled={text.trim().length === 0}>
		Send
	</button>
</form>
