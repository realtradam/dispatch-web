/**
 * The frontend plugin ABI version + the semver handshake (plan 03 §3.2).
 *
 * FRONTEND_ABI_VERSION is bumped on BREAKING ABI changes only — an ADDITIVE
 * member bumps the MINOR (plan 04 added `layout`: "1" → "1.1"; v1 plugins
 * keep working, see the bare-major rule below). A plugin's
 * `manifest.frontend.apiVersion` is a semver RANGE that must include the
 * host's version; a mismatch lists the plugin as "incompatible frontend
 * plugin" in the manager UI and its module is NEVER imported.
 *
 * `isFrontendCompatible` mirrors the backend kernel's
 * `isApiVersionCompatible` semantics (host/src/host/version.ts) so both
 * sides of the handshake behave identically. It additionally accepts
 * major-only versions/ranges ("1", "^1") — the ABI's version grammar is
 * single-number, normalized here to x.y.z with zeros — because a frontend
 * ABI ("1") is not a kernel release ("0.1.0") and authors declare `"^1"`.
 * A BARE-major range ("1", "^1", "~1" — no explicit minor) is a
 * MAJOR-compatibility claim: it accepts every additive (minor) bump of that
 * major, which is what makes "^1"/"1" plugins keep working on the 1.1 ABI
 * (an author pinning minor/patch declares it explicitly: "1.0.0", "~1.0").
 */

export const FRONTEND_ABI_VERSION = "1.1";

/**
 * The host version the handshake checks against (normalized to semver) —
 * tracks FRONTEND_ABI_VERSION's major.minor at a 0 patch.
 */
const HOST_VERSION = "1.1.0";

interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** The range string named the minor EXPLICITLY (a pin, not a bare major). */
  readonly explicitMinor: boolean;
}

/** Parse a 1–3 component version ("1", "1.0", "1.0.0") — missing parts are 0. */
function parseSemver(version: string): SemVer | null {
  const match = version.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    explicitMinor: match[2] !== undefined,
  };
}

function gte(a: SemVer, b: SemVer): boolean {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch >= b.patch;
}

/**
 * Whether the plugin's declared `frontend.apiVersion` range includes the
 * host's FRONTEND_ABI_VERSION. A malformed range is NEVER compatible (a
 * plugin-verify check catches it at authoring time; the handshake fails
 * closed here).
 */
export function isFrontendCompatible(apiVersion: string, hostVersion = HOST_VERSION): boolean {
  const range = apiVersion.trim();
  if (range === "*") return true;
  const host = parseSemver(hostVersion);
  if (host === null) return false;

  if (range.startsWith("^")) {
    const min = parseSemver(range.slice(1));
    if (min === null) return false;
    if (!gte(host, min)) return false;
    if (min.major === 0) {
      return host.major === 0 && (min.explicitMinor ? host.minor === min.minor : true);
    }
    return host.major === min.major;
  }
  if (range.startsWith("~")) {
    const min = parseSemver(range.slice(1));
    if (min === null) return false;
    if (!gte(host, min)) return false;
    // A BARE "~1" is a major-compatibility claim (any 1.x.y); an explicit
    // minor ("~1.0") pins the minor, as tilde always has.
    if (!min.explicitMinor) return host.major === min.major;
    return host.major === min.major && host.minor === min.minor;
  }
  if (range.startsWith(">=")) {
    const min = parseSemver(range.slice(2));
    if (min === null) return false;
    return gte(host, min);
  }
  const exact = parseSemver(range);
  if (exact === null) return false;
  // A BARE major ("1") names the major only — it accepts that major's
  // additive bumps (the "v1 plugins keep working" rule). An explicit
  // version ("1.0", "1.0.0") pins exactly, as before.
  if (!exact.explicitMinor) return host.major === exact.major;
  return host.major === exact.major && host.minor === exact.minor && host.patch === exact.patch;
}
