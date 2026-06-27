/**
 * Resolve an `ImageChunk.url` into a renderable `<img src>` value.
 *
 * Persisted image chunks now carry a COMPACT HTTP path
 * (`/images/<conversationId>/<uuid>.png`) served by the backend — NOT a base64
 * data URL (images are stored on disk under tmp, not in the conversation store,
 * to keep SQLite payloads small). The optimistic echo (what the FE just sent in
 * `ChatRequest.images`) still carries a data URL, and a chunk could also carry
 * an absolute `http(s)://` URL, so the resolution is format-aware:
 *
 * - `data:` URL  → returned as-is (the optimistic echo / a pasted data URL).
 * - `http(s)://` → returned as-is (an absolute URL already).
 * - anything else (a relative path like `/images/…`) → `apiBase` is prepended
 *   (with no double slash). An empty `apiBase` leaves a root-relative path,
 *   which a browser resolves against the document origin.
 *
 * Pure: input → output, zero DOM, zero Svelte.
 *
 * @param url      The chunk's `url` (data URL, absolute, or relative path).
 * @param apiBase  The HTTP API base URL (e.g. `http://localhost:24203`).
 */
export function resolveImageUrl(url: string, apiBase: string): string {
  if (url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  // A relative path (e.g. `/images/…`) — normalize to a leading slash and
  // prepend the api base. With an empty base this yields a root-relative path
  // (a browser resolves `/images/…` against the document origin).
  const path = url.startsWith("/") ? url : `/${url}`;
  if (apiBase.length === 0) return path;
  // Join without a double slash: strip a trailing slash from the base, then
  // append the (leading-slash) path verbatim.
  const base = apiBase.endsWith("/") ? apiBase.slice(0, -1) : apiBase;
  return `${base}${path}`;
}
