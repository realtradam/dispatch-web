<script lang="ts">
  import type { ImageInput } from "@dispatch/wire";
  import { convertToJpeg, type ConvertedJpeg, type ImageJpegEncoder } from "../adapter/image-encode";
  import { stopButtonLabels } from "../logic/composer";
  import { MAX_IMAGE_EDGE_PX, shouldConvertImage } from "../logic/image-compress";
  import { computeContextUsage, formatCompactTokens } from "../../../core/metrics";

  const FALLBACK_CONTEXT_WINDOW = 1_000_000;
  const MAX_LINES = 7;
  /** Accept only raster images (the provider image-content formats). */
  const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
  /** Reject images larger than this before base64-encoding (keeps payloads sane). */
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  /** Tooltip on the per-image compress toggle (PNG → JPEG + resize). */
  const COMPRESS_TOOLTIP = `Re-encode PNG to JPEG and resize to ${MAX_IMAGE_EDGE_PX}px (smaller upload). Unchecked sends the original bytes.`;

  /**
   * A staged image awaiting send: a stable id + everything needed to resolve
   * the `ImageInput` that will actually be sent. The ORIGINAL `File` (and its
   * data URL) is kept so the per-image compress toggle is reversible until
   * send; the async conversion result is cached so flipping the toggle never
   * re-encodes.
   */
  interface StagedImage {
    readonly id: string;
    /** The original untouched File — sent verbatim when compress is off. */
    readonly file: File;
    /** Data URL of the original (staged immediately — conversion is async). */
    readonly originalUrl: string;
    readonly originalMimeType: string | undefined;
    /** Whether the converted (JPEG) variant is used for send. Default ON. */
    compress: boolean;
    /** Cached conversion (data URL of the JPEG); `null` = none/failed/n.a. */
    converted: { url: string } | null;
  }

  /**
   * The `ImageInput` this staged image will actually SEND: the converted JPEG
   * (data URL + `image/jpeg`) when compress is on AND a conversion exists,
   * otherwise the original untouched bytes.
   */
  function imageInput(img: StagedImage): ImageInput {
    if (img.compress && img.converted !== null) {
      return { url: img.converted.url, mimeType: "image/jpeg" };
    }
    const { originalUrl: url, originalMimeType: mimeType } = img;
    return { url, ...(mimeType ? { mimeType } : {}) };
  }

  /** Whether the compress toggle is rendered for this image (convertible formats only). */
  function compressible(img: StagedImage): boolean {
    return shouldConvertImage(img.originalMimeType);
  }

  let {
    onSend,
    onQueue,
    onStop,
    encodeJpeg = convertToJpeg,
    contextSize = undefined,
    contextWindow = undefined,
    status = "idle",
    queuedMessageCount = undefined,
  }: {
    /**
     * Send a message (start a turn via `chat.send`). Carries any staged images
     * as `ImageInput[]` (base64 data URLs or https URLs); the store forwards
     * them on the WS `chat.send` op / `POST /chat` body. `images` is omitted
     * (not an empty array) when none are staged, so the wire stays text-only.
     */
    onSend: (text: string, images?: ImageInput[]) => void;
    /**
     * Enqueue a steering message (`chat.queue`). When provided AND the status
     * is `running`, the send button becomes a "Queue" button that steers the
     * in-flight turn instead of starting a new one. Carries staged images just
     * like onSend; without this callback, in-flight input stays staged.
     */
    onQueue?: (text: string, images?: ImageInput[]) => void;
    /** Stop the in-flight generation (`POST /conversations/:id/stop`). */
    onStop?: () => void;
    /**
     * Injected compression edge (a `File` in, a maybe-smaller JPEG out).
     * Defaults to the real canvas converter; tests stub this outermost edge.
     */
    encodeJpeg?: ImageJpegEncoder;
    // Current context occupancy — updated progressively during a turn (the
    // latest step's input+output) and finalized to the turn's `contextSize` on
    // seal, or `undefined` when unknown — the status bar then shows
    // "— tokens", never 0%.
    contextSize?: number | undefined;
    /** Per-model context window (max tokens) from `GET /models` modelInfo. */
    contextWindow?: number | undefined;
    /**
     * Coarse agent status for the status-bar icon. `queued` = the turn is in
     * flight but waiting for a concurrency slot (CR-13) — shown as a loading
     * RING (vs the loading DOTS of `running`/actively generating). Behaves like
     * `running` for the send button (steer/stop).
     */
    status?: ComposerStatus;
    /** Current conversation's queued snapshot size; undefined when unavailable. */
    queuedMessageCount?: number | undefined;
  } = $props();

  export type ComposerStatus = "idle" | "running" | "queued" | "error";

  let text = $state("");
  let images = $state<StagedImage[]>([]);
  let inputEl: HTMLTextAreaElement | undefined;
  let fileInputEl: HTMLInputElement | undefined;
  let dragOver = $state(false);

  const hasText = $derived(text.trim().length > 0);
  const hasImages = $derived(images.length > 0);
  const inFlight = $derived(status === "running" || status === "queued");
  const canSend = $derived((hasText || hasImages) && (!inFlight || onQueue !== undefined));
  const effectiveMax = $derived(contextWindow ?? FALLBACK_CONTEXT_WINDOW);
  const usage = $derived(computeContextUsage(contextSize, effectiveMax));

  // One button, three modes:
  // - idle → "Send" (starts a turn via chat.send)
  // - running/queued + text/images → "Queue" (steers via chat.queue)
  // - running/queued + empty → "Stop" (aborts via POST /stop)
  // (`queued` behaves like `running` — the turn is in flight, just waiting for a
  // concurrency slot; the user can still steer or stop it.)
  const buttonMode = $derived.by<"send" | "queue" | "stop">(() => {
    if (inFlight && !hasText && !hasImages && onStop !== undefined) return "stop";
    if (inFlight) return "queue";
    return "send";
  });
  const stopButton = $derived(stopButtonLabels(queuedMessageCount));
  const placeholder = $derived(
    status === "queued"
      ? "Queued for a slot…"
      : status === "running"
        ? "Steer the conversation..."
        : "Type a message, paste or drop an image…",
  );

  // As the window fills, escalate color: calm → warning → danger.
  function fillClass(pct: number): string {
    if (pct >= 90) return "progress-error";
    if (pct >= 70) return "progress-warning";
    return "progress-success";
  }

  function resize(): void {
    const el = inputEl;
    if (!el) return;
    el.style.height = "auto";
    const style = getComputedStyle(el);
    const lineHeight = Number.parseFloat(style.lineHeight) || 20;
    const paddingY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const borderY =
      Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
    const maxHeight = lineHeight * MAX_LINES + paddingY + borderY;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  // Re-run resize whenever the value changes (covers programmatic clears too).
  $effect(() => {
    void text;
    resize();
  });

  /** Read a File/Blob into a base64 data URL (`data:image/…;base64,…`). */
  function fileToDataUrl(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("unreadable image"));
      };
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(file);
    });
  }

  let imgSeq = 0;
  /** Stage a File as an image (skip non-images / oversized). Returns whether staged. */
  async function stageFile(file: File): Promise<boolean> {
    if (!file.type.startsWith("image/")) return false;
    if (file.size > MAX_IMAGE_BYTES) return false;
    const url = await fileToDataUrl(file);
    // Prefer the file's declared MIME; fall back to the data URL's prefix.
    const mimeType = file.type || undefined;
    const id = `img-${Date.now()}-${imgSeq++}`;
    images = [
      ...images,
      {
        id,
        file,
        originalUrl: url,
        originalMimeType: mimeType,
        compress: true, // compress is ON by default for every staged image
        converted: null,
      },
    ];
    // Convert async in the background — staging is never blocked on it; the
    // staged input stays the original until the converted URL arrives.
    if (shouldConvertImage(mimeType)) {
      void runConversion(id);
    }
    return true;
  }

  /**
   * Run the (injected) compression edge for a staged image and cache the
   * result. ANY failure (rejecting encoder included) resolves to no
   * conversion → the original is sent; compression never breaks staging. If
   * the image was removed while converting, the result is dropped.
   */
  async function runConversion(id: string): Promise<void> {
    const staged = images.find((img) => img.id === id);
    if (staged === undefined) return;
    let result: ConvertedJpeg | null = null;
    try {
      result = await encodeJpeg(staged.file);
    } catch {
      result = null; // fall back to the original — never block or break sending
    }
    const entry = images.find((img) => img.id === id);
    if (entry === undefined) return; // removed mid-conversion
    entry.converted = result === null ? null : { url: await fileToDataUrl(result.blob) };
  }

  /** Flip the per-image compress toggle (reversible until send). */
  function setCompress(id: string, compress: boolean): void {
    const entry = images.find((img) => img.id === id);
    if (entry !== undefined) entry.compress = compress;
  }

  function removeImage(id: string): void {
    images = images.filter((img) => img.id !== id);
  }

  /** Handle a paste anywhere in the form: extract image items from the clipboard. */
  async function handlePaste(e: ClipboardEvent): Promise<void> {
    const items = e.clipboardData?.items;
    if (items === undefined) return;
    let hadImage = false;
    const staged: File[] = [];
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file !== null) {
          staged.push(file);
          hadImage = true;
        }
      }
    }
    if (!hadImage) return; // let the default text paste proceed
    e.preventDefault(); // suppress pasting the image as a filename string
    for (const file of staged) {
      await stageFile(file);
    }
  }

  /** File-picker <input type="file"> change. */
  async function handleFilePick(e: Event): Promise<void> {
    const target = e.currentTarget as HTMLInputElement;
    const files = target.files;
    if (files === null) return;
    for (const file of files) {
      await stageFile(file);
    }
    target.value = ""; // reset so picking the same file again re-fires change
  }

  /** Drop images onto the composer. */
  async function handleDrop(e: DragEvent): Promise<void> {
    dragOver = false;
    const files = e.dataTransfer?.files;
    if (files === undefined || files.length === 0) return;
    const hadImage = Array.from(files).some((f) => f.type.startsWith("image/"));
    if (!hadImage) return;
    e.preventDefault();
    for (const file of files) {
      await stageFile(file);
    }
  }

  function handleSubmit(): void {
    const trimmed = text.trim();
    // Allow a send with images even when text is empty (an image-only turn).
    if (trimmed.length === 0 && !hasImages) return;
    const toSend = hasImages ? images.map((img) => imageInput(img)) : undefined;
    if (inFlight) {
      if (onQueue === undefined) return; // Keep staged input if no queue port is wired.
      onQueue(trimmed, toSend);
    } else {
      onSend(trimmed, toSend);
    }
    // Clear only after handing the complete input to a callback. WS is still
    // fire-and-forget: this does not imply backend storage has completed.
    text = "";
    images = [];
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }
</script>

<form
  class="flex flex-col"
  onsubmit={(e) => {
    e.preventDefault();
    handleSubmit();
  }}
  ondrop={handleDrop}
  ondragover={(e) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      dragOver = true;
    }
  }}
  ondragleave={() => (dragOver = false)}
>
  <!-- Top bar: expanding textarea + image-attach button + single context-aware button -->
  <div class="flex items-end gap-2 px-4 pt-3 pb-2">
    <div
      class="min-w-0 flex-1"
      onpaste={handlePaste}
      class:border-2={dragOver}
      class:border-primary={dragOver}
      class:border-dashed={dragOver}
      class:rounded={dragOver}
    >
      <textarea
        bind:this={inputEl}
        class="textarea textarea-bordered w-full resize-none leading-normal !min-h-0 h-auto"
        bind:value={text}
        onkeydown={handleKeydown}
        {placeholder}
        rows="1"
        aria-label="Message input"></textarea>
    </div>

    <!-- Hidden file picker (images only; multiple). -->
    <input
      bind:this={fileInputEl}
      type="file"
      accept={IMAGE_ACCEPT}
      multiple
      class="hidden"
      onchange={handleFilePick}
    />
    <!-- Attach image button (opens the file picker). -->
    <button
      class="btn btn-ghost btn-square shrink-0"
      type="button"
      aria-label="Attach image"
      title="Attach image"
      onclick={() => fileInputEl?.click()}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-5 w-5"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <circle cx="8.5" cy="8.5" r="1.5"></circle>
        <polyline points="21 15 16 10 5 21"></polyline>
      </svg>
    </button>

    {#if buttonMode === "stop"}
      <button
        class="btn btn-error w-20 shrink-0"
        type="button"
        aria-label={stopButton.ariaLabel}
        title={stopButton.title}
        onclick={() => onStop?.()}
      >
        {stopButton.text}
      </button>
    {:else}
      <button class="btn btn-primary w-20 shrink-0" type="submit" disabled={!canSend}>
        {buttonMode === "queue" ? "Queue" : "Send"}
      </button>
    {/if}
  </div>

  <!-- Staged image thumbnails (previews) with remove buttons. -->
  {#if hasImages}
    <div class="flex flex-wrap gap-2 px-4 pb-1">
      {#each images as img (img.id)}
        <div class="group relative h-20 w-20 shrink-0 overflow-hidden rounded border border-base-300">
          <!-- Preview what will actually be sent (the converted JPEG when compress is on). -->
          <img
            src={imageInput(img).url}
            alt={imageInput(img).mimeType ?? "staged image"}
            class="h-full w-full object-cover"
          />
          <button
            class="btn btn-circle btn-xs absolute right-0 top-0 bg-base-100/80 hover:bg-error hover:text-error-content"
            type="button"
            aria-label="Remove image"
            onclick={() => removeImage(img.id)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-3 w-3"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <!-- Per-image compress toggle (convertible formats only; reversible until send). -->
          {#if compressible(img)}
            <label
              class="absolute bottom-0 left-0 flex items-center gap-1 bg-base-100/80 px-1 py-0.5 text-[10px] leading-none"
              title={COMPRESS_TOOLTIP}
            >
              <input
                type="checkbox"
                class="checkbox checkbox-xs"
                aria-label="Compress image"
                checked={img.compress}
                onchange={(e) => setCompress(img.id, e.currentTarget.checked)}
              />
              <span class="whitespace-nowrap">Compress</span>
            </label>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Bottom status bar: status icon · context-window fill · token count -->
  <div class="flex items-center gap-2 px-4 pb-2 text-xs text-base-content/50">
    <span class="shrink-0">
      {#if status === "queued"}
        <!-- Waiting for a concurrency slot — a ring (vs the dots of `running`). -->
        <span
          class="loading loading-ring loading-xs text-primary"
          aria-label="Queued"
          title="Waiting for a concurrency slot"
        ></span>
      {:else if status === "running"}
        <span class="loading loading-dots loading-xs text-primary"></span>
      {:else if status === "error"}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-4 w-4 text-error"
          aria-label="Error"
        >
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      {:else}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-4 w-4 text-success"
          aria-label="Idle"
        >
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      {/if}
    </span>

    {#if usage.percent !== null}
      <progress
        class="progress h-2 flex-1 {fillClass(usage.percent)}"
        value={usage.percent}
        max="100"
      ></progress>
    {:else}
      <progress class="progress h-2 flex-1 opacity-40" value="0" max="100"></progress>
    {/if}

    <span class="shrink-0 whitespace-nowrap font-mono">
      {#if usage.current !== null}
        {formatCompactTokens(usage.current)}{#if usage.max !== null}<span
            class="text-base-content/40"
          >
            / {formatCompactTokens(usage.max)}</span
          >{/if}
        {#if usage.percent !== null}
          <span class="ml-1">· {usage.percent.toFixed(1)}%</span>
        {/if}
      {:else}
        <span class="text-base-content/40">— tokens</span>
      {/if}
    </span>
  </div>
</form>
