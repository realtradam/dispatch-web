<script lang="ts">
	import { renderMarkdown } from "../logic/markdown";

	let {
		text,
		streaming = false,
	}: {
		text: string;
		/** Balance dangling delimiters while the message is still generating. */
		streaming?: boolean;
	} = $props();

	// Pure transform; the HTML is already DOMPurify-sanitized in renderMarkdown.
	const html = $derived(renderMarkdown(text, { streaming }));

	let container: HTMLElement;

	// One delegated listener on the stable container handles every code block's
	// copy button — including blocks re-created when `html` changes (streaming),
	// since the listener lives on the container, not the buttons. Clipboard is the
	// edge effect; absent (insecure context) → no-op.
	$effect(() => {
		const el = container;
		if (el === undefined) return;

		const onClick = (event: Event): void => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const button = target.closest<HTMLButtonElement>("[data-copy]");
			if (button === null) return;

			const code = button.closest(".code-block")?.querySelector("code")?.textContent ?? "";
			const clipboard = navigator.clipboard;
			if (clipboard === undefined) return;

			void clipboard
				.writeText(code)
				.then(() => {
					const prev = button.textContent;
					button.textContent = "Copied";
					setTimeout(() => {
						button.textContent = prev;
					}, 1200);
				})
				.catch(() => {
					// Clipboard denied — leave the button as-is.
				});
		};

		el.addEventListener("click", onClick);
		return () => el.removeEventListener("click", onClick);
	});
</script>

<div class="markdown-body" bind:this={container}>
	<!-- {@html} is safe here: `html` is DOMPurify-sanitized inside renderMarkdown. -->
	{@html html}
</div>
