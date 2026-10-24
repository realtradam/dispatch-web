import { describe, expect, it } from "vitest";
import {
  buildAllowedHosts,
  checkDevRequest,
  checkHost,
  isAllowedLocalAddress,
  normalizeHost,
  normalizeHostHeader,
  tailscaleSelf,
} from "./network-policy";

const tailscaleStatusJson = `{"Self":{"HostName":"laptop",
  "DNSName":"PII_REDACTED_TAILSCALE_HOST_01.",
  "TailscaleIPs":["PII_REDACTED_DEV_IPV4_01","PII_REDACTED_DEV_IPV6_01"]}}`;
const allowedHosts = buildAllowedHosts({ tailscaleStatusJson, env: {} });
const allowedAddresses = new Set(["127.0.0.1", "::1", ...tailscaleSelf(tailscaleStatusJson).ips]);
const policy = { allowedHosts, allowedAddresses };
const request = (localAddress = "::1", host: string | undefined = "localhost", origin?: string) =>
  checkDevRequest({ localAddress, host, origin }, policy);

describe("backend-compatible hosts", () => {
  it.each([
    ["LOCALHOST.:34204", "localhost"],
    ["127.0.0.1:34204", "127.0.0.1"],
    ["[0:0:0:0:0:0:0:1]:34204", "::1"],
    ["PII_REDACTED_DEVICE_01", "PII_REDACTED_DEVICE_01"],
    ["PII_REDACTED_TAILSCALE_HOST_01.:34204", "PII_REDACTED_TAILSCALE_HOST_01"],
    ["PII_REDACTED_DEV_IPV4_01:34204", "PII_REDACTED_DEV_IPV4_01"],
    ["[PII_REDACTED_DEV_IPV6_01]:34204", "PII_REDACTED_DEV_IPV6_01"],
  ])("normalizes and allows %s", (raw, expected) => {
    expect(normalizeHost(raw)).toBe(expected);
    expect(checkHost(raw, allowedHosts)).toBe("ok");
  });

  it.each(
    (
      "evil.com|PII_REDACTED_DEVICE_01.evil.com|PII_REDACTED_DEV_IPV4_01.nip.io|laptop|localhost.evil.com|" +
      "sub.localhost|127.0.0.2|100.1.2.3|172.17.0.1|localhost@evil.com|localhost/path|" +
      "localhost:bad|localhost:65536|[::1]suffix|localhost\n|localhost..|%6cocalhost|"
    ).split("|"),
  )("rejects %j even where Vite would allow it", (host) => {
    expect(checkHost(host, allowedHosts)).toMatchObject({ status: 421 });
  });

  const missingStatuses = [undefined, "invalid", "null", "[]", "{}", '{"Self":null}'];
  it.each(missingStatuses)("fails closed for status %j, retains env overrides", (json) => {
    const input = {
      ...(json !== undefined ? { tailscaleStatusJson: json } : {}),
      env: {
        DISPATCH_ALLOWED_HOSTS: " EXTRA.example.:8080, https://evil.com",
        DISPATCH_TAILSCALE_NAME: "PII_REDACTED_DEVICE_01",
      },
    };
    const expected = "localhost,127.0.0.1,::1,extra.example,PII_REDACTED_DEVICE_01".split(",");
    expect([...buildAllowedHosts(input)]).toEqual(expected);
    expect(tailscaleSelf(json)).toEqual({ ips: [] });
  });

  it("keeps auto-detection when env hosts are supplied, without trusting OS hostname", () => {
    const hosts = buildAllowedHosts({
      tailscaleStatusJson,
      env: { DISPATCH_ALLOWED_HOSTS: "extra.example" },
    });
    expect(hosts.has("PII_REDACTED_TAILSCALE_HOST_01")).toBe(true);
    expect(hosts.has("extra.example")).toBe(true);
    expect(hosts.has("laptop")).toBe(false);
    expect(tailscaleSelf(tailscaleStatusJson).hostName).toBe("laptop");
    expect(
      tailscaleSelf('{"Self":{"TailscaleIPs":[null,"evil.com","PII_REDACTED_DEV_IPV4_01"]}}').ips,
    ).toEqual(["PII_REDACTED_DEV_IPV4_01"]);
  });

  it.each([
    ["LOCALHOST.:34204", "localhost:34204"],
    ["[0:0:0:0:0:0:0:1]:34204", "[::1]:34204"],
    ["[::1]", "[::1]"],
    ["PII_REDACTED_DEVICE_01.", "PII_REDACTED_DEVICE_01"],
  ])("preserves valid authorities for Vite: %s", (raw, expected) => {
    expect(normalizeHostHeader(raw)).toBe(expected);
  });
});

describe("destination interfaces (not remote peer addresses)", () => {
  it.each(
    (
      "127.0.0.1|::1|0:0:0:0:0:0:0:1|::ffff:127.0.0.1|::ffff:7f00:1|" +
      "PII_REDACTED_DEV_IPV4_01|::ffff:PII_REDACTED_DEV_IPV4_01|PII_REDACTED_DEV_IPV6_01"
    ).split("|"),
  )("allows local address %s", (address) => {
    expect(isAllowedLocalAddress(address, allowedAddresses)).toBe(true);
  });

  it.each([
    undefined,
    ..."|172.17.0.1|::ffff:172.17.0.1|192.168.1.2|100.1.2.3|0.0.0.0|::|127.0.0.2".split("|"),
  ])("rejects non-selected interface %j", (address) => {
    expect(isAllowedLocalAddress(address, allowedAddresses)).toBe(false);
    // undefined must not use the helper's default loopback address.
    expect(
      checkDevRequest({ localAddress: address, host: "localhost", origin: undefined }, policy),
    ).toMatchObject({ status: 403 });
  });

  it("does not treat an env host extra as an allowed interface", () => {
    const hosts = buildAllowedHosts({ env: { DISPATCH_ALLOWED_HOSTS: "172.17.0.1" } });
    expect(
      checkDevRequest(
        { localAddress: "172.17.0.1", host: "172.17.0.1", origin: undefined },
        { allowedHosts: hosts, allowedAddresses },
      ),
    ).toMatchObject({ status: 403 });
  });
});

describe("shared HTTP / HMR request decision", () => {
  it.each([
    undefined,
    "http://PII_REDACTED_DEVICE_01.:34204",
    "https://[PII_REDACTED_DEV_IPV6_01]:443",
  ])("allows trusted or absent Origin %j", (origin) => {
    expect(request("::ffff:PII_REDACTED_DEV_IPV4_01", "PII_REDACTED_DEVICE_01", origin)).toBe("ok");
  });
  const badOrigins =
    "null|file://localhost|https://evil.com|http://localhost/|http://user@localhost";
  it.each(badOrigins.split("|"))("rejects Origin %j", (origin) => {
    expect(request("::1", "localhost", origin)).toMatchObject({ status: 403 });
  });
  it("requires Host and checks it before Origin", () => {
    for (const host of [undefined, "evil.com"]) {
      expect(
        checkDevRequest({ localAddress: "127.0.0.1", host, origin: "null" }, policy),
      ).toMatchObject({ status: 421 });
    }
  });
});
