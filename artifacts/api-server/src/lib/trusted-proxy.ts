import { isIP } from "node:net";

// Trust addresses, never an arbitrary number of hops. Only Nginx should be able
// to reach the API and it must overwrite client-supplied forwarding headers.
export function trustedProxyAddresses(value = process.env.TRUST_PROXY): string[] {
  if (value === undefined) return ["loopback"];
  const addresses = value.split(",").map(address => address.trim());
  for (const address of addresses) {
    if (address === "loopback" || address === "uniquelocal") continue;
    const [ip, prefix, ...extra] = address.split("/");
    const version = isIP(ip);
    if (!version || extra.length || (prefix !== undefined &&
      (!/^[1-9]\d*$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)))) {
      throw new Error("TRUST_PROXY must contain proxy IPs/CIDRs, loopback or uniquelocal; unrestricted trust is not allowed");
    }
  }
  return addresses;
}