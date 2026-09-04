import { DEFAULT_LAYOUT, type LayoutTree } from "@dispatch/layout-contract";
import type { LayoutHttp, LayoutHttpResult } from "./adapter/http";
import { migrationTree } from "./logic/migration";

/**
 * Layout store (plan 02 §2.6) — a thin reactive wrapper over the injected
 * `LayoutHttp` edge (the plugins-store pattern). Owns the ACTIVE workspace's
 * tree and the provider lifecycle:
 *
 * - **Provider probe triggers** — boot, every workspace switch, and every
 *   `extensions-changed` (a provider enabled/disabled mid-session starts/
 *   stops serving; the probe picks it up without a reload).
 * - **No-provider mode** — a 404 (or network failure) keeps the tree on its
 *   local default; edits still work but are EPHEMERAL (in-memory only —
 *   D-L4 retired the localStorage write path); logged once, no error UI.
 * - **WS push** — `onServerTree(workspaceId, tree)` applies a `layout`
 *   broadcast, ignoring non-active workspaces (the server fans out to all
 *   clients; the client filters).
 * - **User edits persist through the provider** — `onTreeChange` applies the
 *   edit locally immediately, then PUTs the WHOLE tree (decision 7 — no
 *   patch protocol) lightly debounced; on a failed PUT the tree rolls back
 *   to the last server-known tree with a quiet console warning.
 * - **Collapse state stays local** (decision 3) — `dispatch.sidebar.open`
 *   is the collapse store's concern, untouched here.
 * - **One-way localStorage migration** (§2.7) — on the FIRST successful
 *   provider read of the boot session, if `dispatch.sidebar.views` exists
 *   AND the fetched tree is the untouched default seed, the stored panel
 *   selection is imported with one PUT; the key is then never read again.
 *
 * No ambient state: one instance per composition root, passed explicitly;
 * no module-level mutables.
 */

/** Whether an active provider is serving the active workspace. */
export type LayoutProviderState = "unknown" | "present" | "absent";

export interface LayoutStore {
  /** The rendered tree for the ACTIVE workspace (starts at the local default). */
  readonly tree: LayoutTree;
  /** The active provider's state (absent = the no-provider degrade path). */
  readonly providerState: LayoutProviderState;
  /** The workspace the tree currently belongs to. */
  readonly activeWorkspaceId: string;
  /**
   * Probe the provider for `workspaceId`'s tree. `boot: true` (the composition
   * root's boot call) also arms the one-way localStorage migration (§2.7),
   * which consumes itself on the first successful provider read regardless of
   * outcome. A probe is the missed-push catch-up (§2.5).
   */
  probe(workspaceId: string, opts?: { readonly boot?: boolean }): Promise<void>;
  /** Workspace switch: reset to the local default for the new workspace + probe. */
  onWorkspaceChanged(workspaceId: string): void;
  /** Server `layout` broadcast (§2.5). Non-active workspaces are ignored. */
  onServerTree(workspaceId: string, tree: LayoutTree): void;
  /** A user edit (the panels' dropdowns / TileRoot ops). Persists via PUT. */
  onTreeChange(next: LayoutTree): void;
  /** Multi-client coherence (§11): re-probe on `extensions-changed`. */
  onExtensionsChanged(): void;
}

export interface LayoutStoreOptions {
  readonly http: LayoutHttp;
  /** The boot workspace (its URL slug); "default" if absent. */
  readonly workspaceId?: string;
  /**
   * Injected localStorage — read ONLY by the one-way §2.7 migration (the
   * write path is retired; collapse state has its own store). Undefined →
   * migration never applies (tests / storageless contexts).
   */
  readonly storage?: Storage | undefined;
  /** The known (registered) view ids, for the migration's unknown-id filter. */
  readonly knownViews?: ReadonlySet<string> | readonly string[];
  /**
   * The localStorage key the §2.7 migration reads (default
   * `dispatch.sidebar.views`; tests override).
   */
  readonly sidebarViewsKey?: string;
  /** Edit-PUT debounce window in ms (default 300; tests shrink it). */
  readonly debounceMs?: number;
  /** The quiet-failure hook (default `console.warn` — never an error UI). */
  readonly warn?: (message: string) => void;
}

const DEFAULT_SIDEBAR_VIEWS_KEY = "dispatch.sidebar.views";
const DEFAULT_DEBOUNCE_MS = 300;

function toKnownSet(known: LayoutStoreOptions["knownViews"]): ReadonlySet<string> {
  if (known === undefined) return new Set();
  return known instanceof Set ? known : new Set(known);
}

export function createLayoutStore(opts: LayoutStoreOptions): LayoutStore {
  const http = opts.http;
  const storage = opts.storage;
  const sidebarViewsKey = opts.sidebarViewsKey ?? DEFAULT_SIDEBAR_VIEWS_KEY;
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const knownViews = toKnownSet(opts.knownViews);
  const warn = opts.warn ?? ((message: string) => console.warn(message));

  let tree = $state<LayoutTree>(DEFAULT_LAYOUT);
  let providerState = $state<LayoutProviderState>("unknown");
  let activeWorkspaceId = $state<string>(opts.workspaceId ?? "default");

  /** The last tree known to come from the server (GET / WS push / PUT echo) — the rollback target. */
  let lastServerTree: LayoutTree | null = null;
  /** The pending edit-PUT timer (the "lightly debounced" write). */
  let putTimer: ReturnType<typeof setTimeout> | null = null;
  /** Logged-once guard for the no-provider log (reset when a provider appears). */
  let loggedAbsent = false;
  /**
   * The §2.7 migration is armed by the BOOT probe and consumed by the first
   * successful provider read — regardless of outcome (read-once semantics).
   */
  let migrationArmed = false;

  function noteAbsent(reason: string): void {
    providerState = "absent";
    if (!loggedAbsent) {
      loggedAbsent = true;
      warn(
        `layout: no layout provider active (${reason}) — rendering the built-in default; edits are ephemeral`,
      );
    }
  }

  function notePresent(): void {
    providerState = "present";
    loggedAbsent = false;
  }

  function applyServerTree(next: LayoutTree): void {
    lastServerTree = next;
    tree = next;
  }

  /** The §2.7 one-way migration: at most one read + one PUT per session. */
  async function maybeMigrate(): Promise<void> {
    if (!migrationArmed || storage === undefined) return;
    migrationArmed = false; // consumed regardless of outcome (stop reading the key)
    let raw: string | null = null;
    try {
      raw = storage.getItem(sidebarViewsKey);
    } catch {
      return; // storage unavailable — best-effort, done
    }
    if (raw === null) return; // nothing stored — nothing to import
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return; // junk — best-effort, done
    }
    const migrated = migrationTree(parsed, knownViews, tree);
    if (migrated === null) return; // custom layout already / nothing usable
    const result = await http.putTree(activeWorkspaceId, migrated);
    if (result.ok) {
      // The server's canonical copy (also echoed back via the WS broadcast).
      applyServerTree(result.tree);
    } else if (!result.notFound) {
      warn(`layout: localStorage migration PUT failed — ${result.error}`);
    }
  }

  async function runProbe(workspaceId: string, boot: boolean): Promise<void> {
    if (boot) migrationArmed = true;
    const result: LayoutHttpResult = await http.getTree(workspaceId);
    // A switch may have happened while the fetch was in flight — only the
    // CURRENT workspace's result lands (the refreshProviderStatus guard).
    if (workspaceId !== activeWorkspaceId) return;
    if (result.ok) {
      notePresent();
      applyServerTree(result.tree);
      await maybeMigrate();
    } else if (result.notFound) {
      noteAbsent(result.error);
    } else {
      // A real failure (5xx, malformed) degrades like absent — quietly.
      noteAbsent(result.error);
    }
  }

  function clearPutTimer(): void {
    if (putTimer !== null) {
      clearTimeout(putTimer);
      putTimer = null;
    }
  }

  async function flushPut(workspaceId: string, pending: LayoutTree): Promise<void> {
    putTimer = null;
    // Read the CURRENT tree at fire time: a newer edit supersedes the
    // debounced snapshot (one in-flight write per window, last wins).
    const target = tree === pending ? pending : tree;
    const result = await http.putTree(workspaceId, target);
    if (result.ok) {
      notePresent();
      // The server's validated echo is the new rollback target.
      lastServerTree = result.tree;
      return;
    }
    if (result.notFound) {
      // The provider vanished: keep the local edit (ephemeral), no rollback —
      // there is no server tree to roll back TO.
      noteAbsent(result.error);
      return;
    }
    // A failed write on a PRESENT provider: roll back to the last server
    // tree, quiet console warning (never an error UI).
    warn(
      `layout: persisting the tree failed (${result.error}) — rolled back to the last server tree`,
    );
    if (lastServerTree !== null) tree = lastServerTree;
  }

  return {
    get tree() {
      return tree;
    },
    get providerState() {
      return providerState;
    },
    get activeWorkspaceId() {
      return activeWorkspaceId;
    },

    async probe(workspaceId, probeOpts) {
      await runProbe(workspaceId, probeOpts?.boot === true);
    },

    onWorkspaceChanged(workspaceId) {
      if (workspaceId === activeWorkspaceId) return;
      activeWorkspaceId = workspaceId;
      // The tree belongs to the OLD workspace now: reset to the local default
      // while the probe resolves (never flash the previous workspace's tree),
      // and drop any queued edit — it was for the old workspace.
      clearPutTimer();
      lastServerTree = null;
      tree = DEFAULT_LAYOUT;
      providerState = "unknown";
      void runProbe(workspaceId, false);
    },

    onServerTree(workspaceId, next) {
      if (workspaceId !== activeWorkspaceId) return; // clients filter (§2.5)
      notePresent();
      clearPutTimer(); // the server's copy supersedes any queued edit
      applyServerTree(next);
    },

    onTreeChange(next) {
      tree = next; // the edit applies locally IMMEDIATELY (the UI never waits)
      if (providerState === "absent") return; // ephemeral — no write, no warning
      clearPutTimer();
      putTimer = setTimeout(() => {
        void flushPut(activeWorkspaceId, next).catch(() => {
          // Network-grade failure: roll back to the last server tree, quietly.
          warn("layout: persisting the tree failed — rolled back to the last server tree");
          if (lastServerTree !== null) tree = lastServerTree;
        });
      }, debounceMs);
    },

    onExtensionsChanged() {
      void runProbe(activeWorkspaceId, false).catch(() => {
        // runProbe never throws for HTTP failures; this guard is for the
        // migration path. Staying silent keeps the degrade quiet.
      });
    },
  };
}
