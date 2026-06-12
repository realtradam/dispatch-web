# `@dispatch/ui-contract` — in-repo reference (read THIS, not node_modules)

> This MIRRORS the backend's `@dispatch/ui-contract` package source so headless FE agents can
> read the surface contract WITHOUT following the `file:` dep symlink out of this repo (which
> hangs on a permission prompt). Your CODE still imports `@dispatch/ui-contract` normally — this
> file is for READING only.
>
> **Orchestrator:** this is a SNAPSHOT of `ui-contract@0.2.0` — regenerate it whenever
> `ui-contract` changes.
>
> **2026-06-12 delta (CR-2/CR-4 handoff — package bumped `0.1.0` → `0.2.0`):** adds the optional
> `scope?: "global" | "conversation"` to `SurfaceCatalogEntry` so a client can skip re-subscribing
> GLOBAL surfaces on a conversation switch. ABSENT means assume conversation-scoped (the
> conservative always-send-conversationId policy remains correct for both). Emitted today:
> `loaded-extensions` → `"global"`, `cache-warming` → `"conversation"`. Also (CR-4d, no shape
> change): the initial `surface` reply to a conversation-scoped subscribe ECHOES `conversationId`
> as documented (was already on backend HEAD; verify with a freshly-booted backend).
>
> **2026-06 delta (cache-warming handoff):** adds the `NumberField` variant (`kind:"number"`) to
> the `SurfaceField` union, and an OPTIONAL `conversationId?` to `SubscribeMessage` /
> `UnsubscribeMessage` / `InvokeMessage` / `SurfaceMessage` / `SurfaceUpdate` so a surface can be
> CONVERSATION-SCOPED (state differs per conversation, e.g. `cache-warming`) vs GLOBAL (one state for
> all, e.g. `loaded-extensions`). All additive / backward-compatible: a global surface omits
> `conversationId` and behaves exactly as before.

```ts
/**
 * UI contract — the frontend-agnostic vocabulary for backend-declared "surfaces".
 *
 * A SURFACE is a "data transportation surface": a typed description of what data an
 * extension exposes, its semantics, and the actions that can act on it — NOT UI. It
 * carries STRUCTURE + SEMANTICS + ACTIONS, never styling and never a rendering-
 * framework token. Any client (web/Svelte, CLI, future TUI/mobile) renders a surface
 * in its own idiom, so swapping or adding a client is a zero-backend-change event.
 *
 * This package is types-only (zero runtime) and has ZERO `@dispatch/*` dependencies,
 * so a separate client repo can depend on JUST this contract.
 */

/**
 * Where a surface mounts — a coarse, semantic placement hint, NOT a layout/CSS
 * instruction. A client maps a region to its own idiom; an unknown region falls back
 * to the client's default placement. Deliberately left open (a `string`).
 */
export type Region = string;

/**
 * A typed reference to a backend action a field can invoke. The client posts it back
 * (with a payload); the surface id comes from context.
 */
export interface ActionRef {
	readonly actionId: string;
}

/** One selectable option in a `selector` field. */
export interface SurfaceOption {
	readonly value: string;
	readonly label: string;
}

/**
 * A field within a surface — a SEMANTIC value, not a widget. `kind` is the
 * discriminant a client switches on to pick a renderer.
 */
export type SurfaceField =
	| ToggleField
	| ProgressField
	| SelectorField
	| StatField
	| NumberField
	| ButtonField
	| CustomField;

/** A boolean setting plus the action that flips it. */
export interface ToggleField {
	readonly kind: "toggle";
	readonly label: string;
	readonly value: boolean;
	readonly action: ActionRef;
}

/** A bounded ratio in [0, 1] with a label (e.g. a cache-hit rate). Read-only. */
export interface ProgressField {
	readonly kind: "progress";
	readonly label: string;
	readonly value: number;
}

/** An enum choice: the current value, the options, and the action that sets it. */
export interface SelectorField {
	readonly kind: "selector";
	readonly label: string;
	readonly value: string;
	readonly options: readonly SurfaceOption[];
	readonly action: ActionRef;
}

/** A read-only labelled scalar readout. */
export interface StatField {
	readonly kind: "stat";
	readonly label: string;
	readonly value: string;
}

/**
 * A settable numeric value plus the action that sets it — the free-value
 * counterpart to `selector` (which is a fixed enum). Optional `min`/`max`/`step`
 * are SEMANTIC bounds a client may use to validate/step input; `unit` is a
 * display hint (e.g. "ms", "min"). The client posts the new number as the action
 * payload. Unlike `progress`/`stat` (read-only), this field is interactive.
 */
export interface NumberField {
	readonly kind: "number";
	readonly label: string;
	readonly value: number;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly unit?: string;
	readonly action: ActionRef;
}

/** A labelled action trigger. */
export interface ButtonField {
	readonly kind: "button";
	readonly label: string;
	readonly action: ActionRef;
}

/**
 * The escape hatch: data that fits no semantic field kind. Carries an opaque
 * `payload` + a `rendererId`; clients WITH a renderer for that id show it, others
 * GRACEFULLY SKIP. Keep rare — and the owning extension should export a typed
 * payload type so its bespoke renderer narrows `payload` via a typed symbol.
 */
export interface CustomField {
	readonly kind: "custom";
	readonly rendererId: string;
	readonly payload: unknown;
}

/**
 * A surface: an ordered set of fields mounted in a region, with a title. The atomic
 * unit a backend extension contributes and a client renders.
 */
export interface SurfaceSpec {
	readonly id: string;
	readonly region: Region;
	readonly title: string;
	readonly fields: readonly SurfaceField[];
}

/**
 * A surface-catalog entry — discovery metadata only (no field data).
 */
export interface SurfaceCatalogEntry {
	readonly id: string;
	readonly region: Region;
	readonly title: string;
	/**
	 * Whether the surface's spec/values differ per conversation ("conversation")
	 * or are app-wide ("global"). A client may skip re-subscribing GLOBAL surfaces
	 * on a conversation switch (they ignore `conversationId`). Optional + additive:
	 * when absent, a client should assume conversation-scoped (the conservative
	 * "always send the focused conversationId" policy still works for both).
	 */
	readonly scope?: "global" | "conversation";
}

/** The surface catalog: the list of available surfaces a client can choose to show. */
export type SurfaceCatalog = readonly SurfaceCatalogEntry[];

/**
 * A live update for a subscribed surface (pushed over the WS channel). v1 carries
 * the full new spec (the simplest "patch").
 *
 * `conversationId` is present only for a CONVERSATION-SCOPED surface (one whose
 * spec/values differ per conversation, e.g. cache-warming controls): it tells the
 * client which conversation this update pertains to. A global surface omits it.
 */
export interface SurfaceUpdate {
	readonly surfaceId: string;
	readonly spec: SurfaceSpec;
	readonly conversationId?: string;
}

// ── Surface WebSocket protocol ────────────────────────────────────────────────

/** A client → server message on the surface channel. */
export type SurfaceClientMessage = SubscribeMessage | UnsubscribeMessage | InvokeMessage;

/**
 * Begin receiving live updates for a surface (server replies with `surface`, then `update`s).
 *
 * For a CONVERSATION-SCOPED surface, include the `conversationId` whose state you
 * want — the server resolves the spec for that conversation and pushes its updates.
 * Omit it for a global surface (or to view a conversation-scoped surface with no
 * conversation in focus → the surface decides its default/empty state).
 */
export interface SubscribeMessage {
	readonly type: "subscribe";
	readonly surfaceId: string;
	readonly conversationId?: string;
}

/** Stop receiving updates for a surface (and the same `conversationId`, if scoped). */
export interface UnsubscribeMessage {
	readonly type: "unsubscribe";
	readonly surfaceId: string;
	readonly conversationId?: string;
}

/**
 * Invoke a field's action; `payload` is the new value (e.g. a toggle's boolean, a
 * `number` field's new number). For a conversation-scoped surface, include the
 * `conversationId` the action targets.
 */
export interface InvokeMessage {
	readonly type: "invoke";
	readonly surfaceId: string;
	readonly actionId: string;
	readonly payload?: unknown;
	readonly conversationId?: string;
}

/** A server → client message on the surface channel. */
export type SurfaceServerMessage =
	| CatalogMessage
	| SurfaceMessage
	| SurfaceUpdateMessage
	| SurfaceErrorMessage;

/** The current surface catalog (sent on connect and whenever it changes). */
export interface CatalogMessage {
	readonly type: "catalog";
	readonly catalog: SurfaceCatalog;
}

/**
 * The full current spec for a surface the client just subscribed to.
 * `conversationId` echoes the subscribe's conversation for a conversation-scoped
 * surface (so the client routes it), and is absent for a global surface.
 */
export interface SurfaceMessage {
	readonly type: "surface";
	readonly spec: SurfaceSpec;
	readonly conversationId?: string;
}

/** A live update for a subscribed surface. */
export interface SurfaceUpdateMessage {
	readonly type: "update";
	readonly update: SurfaceUpdate;
}

/** A surface-scoped error (e.g. unknown surface id, invoke failed). */
export interface SurfaceErrorMessage {
	readonly type: "error";
	readonly surfaceId?: string;
	readonly message: string;
}
```
