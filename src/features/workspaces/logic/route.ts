/**
 * Pure routing logic for the workspaces feature — zero DOM, zero effects, zero Svelte.
 *
 * The app is URL-driven: the root path `/` is the workspaces HOME (lists all
 * workspaces); a single path segment `/<id>` opens the workspace with that id
 * (the slug). This module holds the pure mapping from a pathname to a `Route`,
 * plus the slug-validation rules mirrored from the backend's `PUT /workspaces/:id`.
 */

/**
 * The workspace slug regex (mirrors the backend's `PUT /workspaces/:id`
 * validation): 1–40 chars, lowercase alphanumeric with internal hyphens only
 * (no leading/trailing hyphen). `"default"` matches and is a valid (but
 * non-deletable) id.
 */
export const WORKSPACE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** A route derived from the URL path. */
export type Route = { readonly kind: "home" } | { readonly kind: "workspace"; readonly id: string };

/** The reserved id of the always-present fallback workspace. */
export const DEFAULT_WORKSPACE_ID = "default";

/**
 * Parse a pathname into a `Route`. `/` (or empty) → home; a leading segment →
 * the workspace with that id (URL-decoded, surrounding slashes trimmed). Deeper
 * paths take their FIRST segment (nested routes are not used in v1). Pure:
 * pathname in, route out. Does NOT validate the slug — an invalid id still
 * produces a `workspace` route; the backend's ensure call rejects it (the FE
 * surfaces the error).
 */
export function parsePath(pathname: string): Route {
  const trimmed = pathname.replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return { kind: "home" };
  const first = trimmed.split("/")[0] ?? "";
  const id = safeDecode(first);
  if (id === "") return { kind: "home" };
  return { kind: "workspace", id };
}

/**
 * Whether a slug is valid for a NEW workspace (the form the backend accepts).
 * Used by the home view's "new workspace" input before navigating.
 */
export function isValidSlug(slug: string): boolean {
  return WORKSPACE_SLUG_RE.test(slug);
}

/**
 * Build the URL path for a workspace id. Used when navigating to / linking a
 * workspace. Pure: id in, path string out.
 */
export function workspacePath(id: string): string {
  return `/${id}`;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
