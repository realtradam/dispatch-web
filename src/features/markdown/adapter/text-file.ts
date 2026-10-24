import type {
  TextFileContextResponse,
  TextFileQuery,
  TextFileResponse,
} from "@dispatch/transport-contract";
import type { TextFileClient, TextFileState } from "../types";

const MAX_BYTES = 262144;
const MAX_ENTRIES = 32;
const MAX_PARALLEL = 4;
interface Entry {
  readonly listeners: Set<(state: TextFileState) => void>;
  state: TextFileState;
  controller: AbortController;
}
/** Per-mounted-chat, bounded cache: shared only by live references, never persisted. */
export function createTextFileClient(
  apiBase: string,
  conversationId: string,
  fetchImpl: typeof fetch,
): TextFileClient {
  const entries = new Map<string, Entry>();
  let disposed = false;
  let contextController = new AbortController();
  let context: Promise<TextFileContextResponse> | null = null;
  let active = 0;
  const queue = new Map<string, () => void>();
  const endpoint = `${apiBase.replace(/\/$/, "")}/conversations/${encodeURIComponent(conversationId)}`;
  async function json(url: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetchImpl(url, { signal, cache: "no-store" });
    const data: unknown = await response.json();
    if (!response.ok) {
      const error = data as { error?: string };
      throw new Error(error.error ?? `Text file request failed (HTTP ${response.status})`);
    }
    return data;
  }
  function getContext(): Promise<TextFileContextResponse> {
    context ??= json(`${endpoint}/text-file-context`, contextController.signal).then((data) => {
      const c = data as TextFileContextResponse;
      if (
        c.conversationId !== conversationId ||
        !(c.cwd === null || typeof c.cwd === "string") ||
        !(c.computerId === null || typeof c.computerId === "string")
      ) {
        throw new Error("Invalid text file context response");
      }
      return c;
    });
    return context;
  }
  function publish(entry: Entry, state: TextFileState): void {
    entry.state = state;
    for (const listener of entry.listeners) listener(state);
  }
  async function load(path: string, entry: Entry, controller: AbortController): Promise<void> {
    try {
      if (controller.signal.aborted || disposed) return;
      const c = await getContext();
      if (controller.signal.aborted || disposed) return;
      if (c.computerId !== null)
        throw new Error(
          "Text-file embeds are not available for remote computers. No local file was read.",
        );
      const query: TextFileQuery = {
        path,
        expectedCwd: c.cwd ?? "",
        expectedComputerId: c.computerId ?? "",
      };
      const params = new URLSearchParams(query as unknown as Record<string, string>);
      const data = (await json(
        `${endpoint}/text-file?${params}`,
        controller.signal,
      )) as TextFileResponse;
      if (
        typeof data.text !== "string" ||
        typeof data.path !== "string" ||
        !data.path.startsWith("/") ||
        !["markdown", "text"].includes(data.format) ||
        data.maxBytes !== MAX_BYTES ||
        !Number.isInteger(data.bytes) ||
        data.bytes < 0 ||
        data.bytes > MAX_BYTES ||
        new TextEncoder().encode(data.text).length !== data.bytes
      ) {
        throw new Error("Invalid or oversized text file response (maximum 256 KiB)");
      }
      if (!controller.signal.aborted && !disposed) publish(entry, { kind: "ready", file: data });
    } catch (error) {
      if (!controller.signal.aborted && !disposed)
        publish(entry, {
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to read text file",
        });
    }
  }
  function drain(): void {
    while (active < MAX_PARALLEL && queue.size) {
      const next = queue.entries().next().value;
      if (!next) return;
      queue.delete(next[0]);
      next[1]();
    }
  }
  function start(path: string, entry: Entry): void {
    entry.controller.abort();
    const controller = new AbortController();
    entry.controller = controller;
    publish(entry, { kind: "loading" });
    queue.set(path, () => {
      if (controller.signal.aborted || disposed) return;
      active++;
      void load(path, entry, controller).finally(() => {
        active--;
        drain();
      });
    });
    drain();
  }
  return {
    subscribe(path, listener) {
      if (disposed || (!entries.has(path) && entries.size >= MAX_ENTRIES)) {
        listener({
          kind: "error",
          message: "Too many text-file embeds (maximum 32 active files).",
        });
        return () => {};
      }
      let entry = entries.get(path);
      if (!entry) {
        entry = {
          listeners: new Set(),
          state: { kind: "loading" },
          controller: new AbortController(),
        };
        entries.set(path, entry);
        start(path, entry);
      }
      entry.listeners.add(listener);
      listener(entry.state);
      const current = entry;
      return () => {
        current.listeners.delete(listener);
        if (!current.listeners.size) {
          current.controller.abort();
          entries.delete(path);
          queue.delete(path);
        }
        if (!entries.size) {
          contextController.abort();
          contextController = new AbortController();
          context = null;
        }
      };
    },
    refresh(_path) {
      // Refresh can reveal a context change: invalidate ALL live content before rereading.
      contextController.abort();
      contextController = new AbortController();
      context = null;
      for (const [path, entry] of entries) start(path, entry);
    },
    dispose() {
      disposed = true;
      contextController.abort();
      for (const entry of entries.values()) entry.controller.abort();
      entries.clear();
      queue.clear();
    },
  };
}
