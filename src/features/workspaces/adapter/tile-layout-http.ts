import type { TileGeometryMode, TileLayoutData } from "@dispatch/tile-layout-contract";

/**
 * Home tile-layout HTTP effects — the injected edge that talks to the
 * `home-tile-layout` plugin's well-known routes:
 * - `GET /home/tile-layout/:mode` → `{ layout }` (a fresh orientation reads
 *   as the seeded empty document)
 * - `PUT /home/tile-layout/:mode` body `{ layout }` → 200 `{ layout }` /
 *   400 `{ error }`
 * - `DELETE /home/tile-layout/:mode` → the fresh empty document (reset)
 *
 * Mirrors the layout adapter's pattern: `httpBase` + an injected `fetchImpl`
 * (testable without the network). A 404 is NOT a "no document" signal (the
 * backend never 404s a fresh orientation — it seeds): any non-2xx / network
 * failure means "the routes aren't served" (an old backend) or "backend
 * unreachable" — both degrade the store to its local state with ephemeral
 * edits, never an error UI.
 */

/** Outcome of a tile-layout read/write. */
export type TileLayoutHttpResult =
  | { readonly ok: true; readonly layout: TileLayoutData }
  | { readonly ok: false; readonly notFound: boolean; readonly error: string };

export interface TileLayoutHttp {
  getLayout(mode: TileGeometryMode): Promise<TileLayoutHttpResult>;
  putLayout(mode: TileGeometryMode, layout: TileLayoutData): Promise<TileLayoutHttpResult>;
  deleteLayout(mode: TileGeometryMode): Promise<TileLayoutHttpResult>;
}

/** Read an error message from a non-2xx body (`{ error }`), tolerating junk. */
async function errorOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length > 0) return body.error;
  } catch {
    // fall through
  }
  return `HTTP ${res.status}`;
}

/** A malformed 200 (e.g. an SPA-fallback page) degrades like a failure — never poisons the store. */
function malformed(): TileLayoutHttpResult {
  return { ok: false, notFound: false, error: "Malformed tile-layout response" };
}

function route(httpBase: string, mode: TileGeometryMode): string {
  return `${httpBase}/home/tile-layout/${encodeURIComponent(mode)}`;
}

export function createTileLayoutHttp(httpBase: string, fetchImpl: typeof fetch): TileLayoutHttp {
  return {
    async getLayout(mode): Promise<TileLayoutHttpResult> {
      try {
        const res = await fetchImpl(route(httpBase, mode));
        if (res.status === 404) {
          return { ok: false, notFound: true, error: "Tile-layout routes are not served" };
        }
        if (!res.ok) return { ok: false, notFound: false, error: await errorOf(res) };
        const body = (await res.json()) as { layout?: unknown };
        if (body === null || typeof body !== "object" || body.layout === undefined)
          return malformed();
        return { ok: true, layout: body.layout as TileLayoutData };
      } catch (err) {
        return {
          ok: false,
          notFound: false,
          error: err instanceof Error ? err.message : "Tile-layout request failed",
        };
      }
    },

    async putLayout(mode, layout): Promise<TileLayoutHttpResult> {
      try {
        const res = await fetchImpl(route(httpBase, mode), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout }),
        });
        if (res.status === 404) {
          return { ok: false, notFound: true, error: "Tile-layout routes are not served" };
        }
        if (!res.ok) return { ok: false, notFound: false, error: await errorOf(res) };
        const body = (await res.json()) as { layout?: unknown };
        if (body === null || typeof body !== "object" || body.layout === undefined)
          return malformed();
        return { ok: true, layout: body.layout as TileLayoutData };
      } catch (err) {
        return {
          ok: false,
          notFound: false,
          error: err instanceof Error ? err.message : "Tile-layout request failed",
        };
      }
    },

    async deleteLayout(mode): Promise<TileLayoutHttpResult> {
      try {
        const res = await fetchImpl(route(httpBase, mode), { method: "DELETE" });
        if (res.status === 404) {
          return { ok: false, notFound: true, error: "Tile-layout routes are not served" };
        }
        if (!res.ok) return { ok: false, notFound: false, error: await errorOf(res) };
        const body = (await res.json()) as { layout?: unknown };
        if (body === null || typeof body !== "object" || body.layout === undefined)
          return malformed();
        return { ok: true, layout: body.layout as TileLayoutData };
      } catch (err) {
        return {
          ok: false,
          notFound: false,
          error: err instanceof Error ? err.message : "Tile-layout request failed",
        };
      }
    },
  };
}
