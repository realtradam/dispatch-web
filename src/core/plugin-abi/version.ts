/**
 * The frontend plugin ABI version + the semver handshake (plan 03 §3.2).
 *
 * FRONTEND_ABI_VERSION is bumped on BREAKING ABI changes only. A plugin's
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
 */

export const FRONTEND_ABI_VERSION = "1";

/** The host version the handshake checks against (normalized to semver). */
const HOST_VERSION = "1.0.0";

interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Parse a 1–3 component version ("1", "1.0", "1.0.0") — missing parts are 0. */
function parseSemver(version: string): SemVer | null {
  const match = version.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
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
      return host.major === 0 && host.minor === min.minor;
    }
    return host.major === min.major;
  }
  if (range.startsWith("~")) {
    const min = parseSemver(range.slice(1));
    if (min === null) return false;
    if (!gte(host, min)) return false;
    return host.major === min.major && host.minor === min.minor;
  }
  if (range.startsWith(">=")) {
    const min = parseSemver(range.slice(2));
    if (min === null) return false;
    return gte(host, min);
  }
  const exact = parseSemver(range);
  if (exact === null) return false;
  return host.major === exact.major && host.minor === exact.minor && host.patch === exact.patch;
}
