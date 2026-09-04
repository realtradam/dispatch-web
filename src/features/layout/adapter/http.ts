import type { LayoutTree } from "@dispatch/layout-contract";

/**
 * Layout HTTP effects (plan 02 §2.6) — the injected edge that talks to the
 * ACTIVE layout provider's well-known routes:
 * - `GET /workspaces/:id/layout` → `{ tree }` (read seeds a fresh workspace)
 * - `PUT /workspaces/:id/layout` body `{ tree }` → 200 `{ tree }` / 400 `{ error }`
 * - `DELETE /workspaces/:id/layout` → the fresh seed (reset; plan 04 adds the UI)
 *
 * Mirrors the plugins adapter's pattern: `httpBase` + an injected `fetchImpl`
 * (testable without the network). The 404 is a SIGNAL, not an error: it means
 * no layout provider is active, and the store renders its local default with
 * ephemeral edits (never an error UI). A network failure degrades the same way.
 */

/** Outcome of a layout read/write. `notFound` distinguishes the no-provider 404. */
export type LayoutHttpResult =
  | { readonly ok: true; readonly tree: LayoutTree }
  | { readonly ok: false; readonly notFound: boolean; readonly error: string };

export interface LayoutHttp {
  getTree(workspaceId: string): Promise<LayoutHttpResult>;
  putTree(workspaceId: string, tree: LayoutTree): Promise<LayoutHttpResult>;
  deleteTree(workspaceId: string): Promise<LayoutHttpResult>;
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

/** A malformed 200 (e.g. an SPA-fallback page) degrades like a 404 — never poisons the store. */
function malformed(): LayoutHttpResult {
  return { ok: false, notFound: true, error: "Malformed layout response" };
}

export function createLayoutHttp(httpBase: string, fetchImpl: typeof fetch): LayoutHttp {
  return {
    async getTree(workspaceId): Promise<LayoutHttpResult> {
      try {
        const res = await fetchImpl(
          `${httpBase}/workspaces/${encodeURIComponent(workspaceId)}/layout`,
        );
        if (res.status === 404) {
          return { ok: false, notFound: true, error: "No layout provider is active" };
        }
        if (!res.ok) return { ok: false, notFound: false, error: await errorOf(res) };
        const body = (await res.json()) as { tree?: unknown };
        if (body === null || typeof body !== "object" || body.tree === undefined)
          return malformed();
        return { ok: true, tree: body.tree as LayoutTree };
      } catch (err) {
        return {
          ok: false,
          notFound: true,
          error: err instanceof Error ? err.message : "Layout request failed",
        };
      }
    },

    async putTree(workspaceId, tree): Promise<LayoutHttpResult> {
      try {
        const res = await fetchImpl(
          `${httpBase}/workspaces/${encodeURIComponent(workspaceId)}/layout`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tree }),
          },
        );
        if (res.status === 404) {
          return { ok: false, notFound: true, error: "No layout provider is active" };
        }
        if (!res.ok) return { ok: false, notFound: false, error: await errorOf(res) };
        const body = (await res.json()) as { tree?: unknown };
        if (body === null || typeof body !== "object" || body.tree === undefined)
          return malformed();
        return { ok: true, tree: body.tree as LayoutTree };
      } catch (err) {
        return {
          ok: false,
          notFound: true,
          error: err instanceof Error ? err.message : "Layout request failed",
        };
      }
    },

    async deleteTree(workspaceId): Promise<LayoutHttpResult> {
      try {
        const res = await fetchImpl(
          `${httpBase}/workspaces/${encodeURIComponent(workspaceId)}/layout`,
          { method: "DELETE" },
        );
        if (res.status === 404) {
          return { ok: false, notFound: true, error: "No layout provider is active" };
        }
        if (!res.ok) return { ok: false, notFound: false, error: await errorOf(res) };
        const body = (await res.json()) as { tree?: unknown };
        if (body === null || typeof body !== "object" || body.tree === undefined)
          return malformed();
        return { ok: true, tree: body.tree as LayoutTree };
      } catch (err) {
        return {
          ok: false,
          notFound: true,
          error: err instanceof Error ? err.message : "Layout request failed",
        };
      }
    },
  };
}
