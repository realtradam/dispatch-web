import type { SystemPromptVariable } from "@dispatch/transport-contract";

/**
 * Pure core for the system prompt builder — zero DOM, zero effects, zero Svelte.
 *
 * The system prompt is a global template, stored on the backend, resolved once
 * per conversation at first turn (then persisted for prompt-cache safety). The
 * frontend builder exposes the template text plus a palette of available
 * variables; clicking a variable inserts `[type:name]` at the cursor. This module
 * holds the pure logic: tag construction, insertion into a template, and
 * grouping of variables. The HTTP edge is injected via the ports defined below.
 */

// ── Injected ports (composition root adapts the store to these shapes) ─────────

export type SystemPromptLoadResult =
  | { readonly ok: true; readonly template: string }
  | { readonly ok: false; readonly error: string };

export type LoadSystemPrompt = () => Promise<SystemPromptLoadResult>;

export type SystemPromptSaveResult =
  | { readonly ok: true; readonly template: string }
  | { readonly ok: false; readonly error: string };

export type SaveSystemPrompt = (template: string) => Promise<SystemPromptSaveResult>;

export type SystemPromptVariablesResult =
  | { readonly ok: true; readonly variables: readonly SystemPromptVariable[] }
  | { readonly ok: false; readonly error: string };

export type LoadSystemPromptVariables = () => Promise<SystemPromptVariablesResult>;

// ── Template helpers ──────────────────────────────────────────────────────────

/** Build the literal placeholder `[type:name]` for a variable. */
export function buildTag(type: string, name: string): string {
  return `[${type}:${name}]`;
}

/** Build the literal placeholder `[if type:name]` for a conditional block. */
export function buildIfTag(type: string, name: string): string {
  return `[if ${type}:${name}]`;
}

/** Build the literal placeholder `[if !type:name]` for a negated conditional block. */
export function buildIfNotTag(type: string, name: string): string {
  return `[if !${type}:${name}]`;
}

export interface Insertion {
  /** Template text after insertion. */
  template: string;
  /** New cursor position (caret index) after insertion. */
  cursor: number;
}

/**
 * Insert `tag` into `template` at the current selection range. Replaces any
 * selected text. Returns both the new template and the new cursor position so
 * the caller can restore the caret after the inserted tag.
 */
export function insertTag(
  template: string,
  tag: string,
  selectionStart: number,
  selectionEnd: number,
): Insertion {
  const before = template.slice(0, selectionStart);
  const after = template.slice(selectionEnd);
  const next = before + tag + after;
  return { template: next, cursor: selectionStart + tag.length };
}

// ── Variable grouping ─────────────────────────────────────────────────────────

export interface VariableGroup {
  /** Variable type (e.g. `"system"`, `"file"`, `"prompt"`, `"git"`). */
  readonly type: string;
  /** Variables of this type. */
  readonly variables: readonly SystemPromptVariable[];
}

/**
 * Group variables by type, preserving the order of first appearance within each
 * group and the order of first-appearing types.
 */
export function groupVariables(
  variables: readonly SystemPromptVariable[],
): readonly VariableGroup[] {
  const order: string[] = [];
  const map = new Map<string, SystemPromptVariable[]>();
  for (const v of variables) {
    if (!map.has(v.type)) {
      map.set(v.type, []);
      order.push(v.type);
    }
    map.get(v.type)?.push(v);
  }
  return order.map((type) => ({ type, variables: map.get(type) ?? [] }));
}

/** Whether a variable is "dynamic" (any name is valid, e.g. `file:<path>`). */
export function isDynamicVariable(variable: SystemPromptVariable): boolean {
  return variable.dynamic === true;
}
