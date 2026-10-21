import type { PendingInput, PendingInputStorage } from "../pending-inputs";

export function createPendingInputStorage(
  storage: Storage,
  conversationId: string,
): PendingInputStorage {
  const prefix = `dispatch.pending-inputs:${conversationId}:`;
  let known = new Map<string, string>();
  return {
    load() {
      const inputs: PendingInput[] = [];
      const loaded = new Map<string, string>();
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key === null || !key.startsWith(prefix)) continue;
        const raw = storage.getItem(key);
        if (raw === null) continue;
        const input = JSON.parse(raw);
        if (
          (input?.request?.type !== "chat.send" && input?.request?.type !== "chat.queue") ||
          input.request.conversationId !== conversationId ||
          typeof input.request.requestId !== "string" ||
          key !== prefix + input.request.requestId ||
          (input.request.type === "chat.send"
            ? typeof input.request.message !== "string"
            : typeof input.request.text !== "string") ||
          (input.rejection !== undefined && typeof input.rejection !== "string")
        )
          throw new Error("Invalid saved input");
        inputs.push(input);
        loaded.set(input.request.requestId, raw);
      }
      known = loaded;
      return inputs;
    },
    save(inputs) {
      // Per-request keys prevent another browser tab's send/receipt from overwriting ours.
      // Quota/security failures reach the composer BEFORE it clears its staged input.
      const next = new Map(inputs.map((input) => [input.request.requestId, JSON.stringify(input)]));
      for (const [id, raw] of next) {
        if (known.get(id) !== raw) storage.setItem(prefix + id, raw);
      }
      for (const id of known.keys()) {
        if (!next.has(id)) storage.removeItem(prefix + id);
      }
      known = next;
    },
  };
}
