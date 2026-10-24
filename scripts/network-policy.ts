/** Host/Origin semantics mirrored from backend packages/network-policy (review step 2.4).
 * Keep in sync there; no I/O or ambient environment reads in this module.
 */
export interface NetworkPolicyEnv {
  readonly DISPATCH_ALLOWED_HOSTS?: string;
  readonly DISPATCH_TAILSCALE_NAME?: string;
}

export type PolicyDecision<Status extends number> = "ok" | { status: Status; reason: string };
type HeaderValue = string | null | undefined;

function ipAddress(raw: string): string {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(raw)) {
    return raw.split(".").every((part) => Number(part) <= 255 && String(Number(part)) === part)
      ? raw
      : "";
  }
  if (!raw.includes(":") || /[^\da-f:.]/i.test(raw)) return "";
  try {
    return new URL(`http://[${raw}]`).hostname.slice(1, -1);
  } catch {
    return "";
  }
}

/** Invalid authorities normalize to "" (fail closed). Bare IPv6 is also accepted. */
export function normalizeHost(raw: string): string {
  const host = raw.toLowerCase();
  if (host.includes(":") && !host.startsWith("[") && host.split(":").length > 2) {
    return ipAddress(host);
  }
  const match = /^(?:\[([\da-f:.]+)\]|([^\s:/\\@?#[\],%]+))(?::(\d+))?$/.exec(host);
  if (!match || match[0] !== host || (match[3] !== undefined && Number(match[3]) > 65535)) {
    return "";
  }
  if (match[1]) return match[1].includes(":") ? ipAddress(match[1]) : "";
  const name = (match[2] ?? "").replace(/\.$/, "");
  return name.length <= 253 &&
    name.split(".").every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label))
    ? name
    : "";
}

/** OS HostName is deliberately not trusted; the shell may add it after verifying DNS. */
export function buildAllowedHosts(input: {
  tailscaleStatusJson?: string;
  env: NetworkPolicyEnv;
}): ReadonlySet<string> {
  const allowed = new Set(["localhost", "127.0.0.1", "::1"]);
  const add = (raw: string) => {
    const normalized = normalizeHost(raw);
    if (normalized) allowed.add(normalized);
  };
  try {
    const status: unknown = JSON.parse(input.tailscaleStatusJson ?? "null");
    if (status && typeof status === "object" && "Self" in status) {
      const self = status.Self;
      if (self && typeof self === "object") {
        if ("DNSName" in self && typeof self.DNSName === "string") {
          const name = normalizeHost(self.DNSName);
          if (name) {
            add(name);
            add(name.split(".")[0] ?? "");
          }
        }
        if ("TailscaleIPs" in self && Array.isArray(self.TailscaleIPs)) {
          for (const ip of self.TailscaleIPs) {
            if (typeof ip === "string" && ipAddress(ip)) add(ip);
          }
        }
      }
    }
  } catch {
    // Missing/malformed status must leave the loopback and explicit env policy intact.
  }
  for (const host of (input.env.DISPATCH_ALLOWED_HOSTS ?? "").split(",")) add(host.trim());
  if (input.env.DISPATCH_TAILSCALE_NAME) add(input.env.DISPATCH_TAILSCALE_NAME.trim());
  return allowed;
}

export function checkHost(
  hostHeader: HeaderValue,
  allowed: ReadonlySet<string>,
): PolicyDecision<421> {
  const host = hostHeader == null ? "" : normalizeHost(hostHeader);
  return host && allowed.has(host) ? "ok" : { status: 421, reason: "Host is not allowed" };
}

export function checkOrigin(
  originHeader: HeaderValue,
  allowed: ReadonlySet<string>,
): PolicyDecision<403> {
  if (originHeader == null) return "ok";
  const match = /^https?:\/\/([^/\\?#\s]+)$/i.exec(originHeader);
  if (match?.[1] && match[0] === originHeader && checkHost(match[1], allowed) === "ok") {
    try {
      new URL(originHeader);
      return "ok";
    } catch {
      // Reject malformed URL authorities even if they resemble an allowed hostname.
    }
  }
  return { status: 403, reason: "Origin is not allowed" };
}

/** Canonical authority for Vite's narrower parser; preserve ports and IPv6 brackets. */
export function normalizeHostHeader(raw: string): string {
  const host = normalizeHost(raw);
  const port = /^(?:\[[^\]]+\]|[^:]+)(:\d+)$/.exec(raw)?.[1] ?? "";
  return `${host.includes(":") ? `[${host}]` : host}${port}`;
}

/** Only the destination interface matters, NOT the remote peer's IP. */
export function isAllowedLocalAddress(
  address: string | undefined,
  allowedAddresses: ReadonlySet<string>,
): boolean {
  if (!address) return false;
  // Dual-stack Node listeners report IPv4 destinations as ::ffff:a.b.c.d (or hex).
  let normalized = normalizeHost(address);
  if (normalized.startsWith("::ffff:")) {
    const words = normalized.slice(7).split(":");
    if (words.length === 2) {
      const value =
        Number.parseInt(words[0] ?? "", 16) * 65536 + Number.parseInt(words[1] ?? "", 16);
      normalized = [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
    }
  }
  return allowedAddresses.has(normalized);
}

/** Extract only actual IPs; neither env host extras nor a whole Tailscale subnet is trusted. */
export function tailscaleSelf(json: string | undefined): { ips: string[]; hostName?: string } {
  try {
    const self = JSON.parse(json ?? "null")?.Self;
    const ips = Array.isArray(self?.TailscaleIPs)
      ? self.TailscaleIPs.filter(
          (ip: unknown): ip is string => typeof ip === "string" && !!ipAddress(ip),
        )
      : [];
    return {
      ips: ips.map((ip: string) => ipAddress(ip)),
      ...(typeof self?.HostName === "string" ? { hostName: self.HostName } : {}),
    };
  } catch {
    return { ips: [] };
  }
}

export interface DevNetworkPolicy {
  readonly allowedHosts: ReadonlySet<string>;
  readonly allowedAddresses: ReadonlySet<string>;
}

/** Shared HTTP and HMR guard. Host precedes Origin, matching the backend. */
export function checkDevRequest(
  input: { localAddress: string | undefined; host: string | undefined; origin: string | undefined },
  policy: DevNetworkPolicy,
): PolicyDecision<403 | 421> {
  if (!isAllowedLocalAddress(input.localAddress, policy.allowedAddresses)) {
    return { status: 403, reason: "Local interface is not allowed" };
  }
  const host = checkHost(input.host, policy.allowedHosts);
  return host === "ok" ? checkOrigin(input.origin, policy.allowedHosts) : host;
}
