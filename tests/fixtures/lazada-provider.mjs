// Test-only provider simulation, imported ONLY by the disposable test child process.
// Never loaded by application code. These strings are dummy fixtures, not credentials.
import { appendFileSync, readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { setTimeout } from "node:timers/promises";
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const path = url.pathname.replace(/^\/rest/, "");
  if (!["https://auth.lazada.com", "https://api.lazada.co.id"].includes(url.origin)
    || !["/auth/token/create", "/seller/get"].includes(path)) throw new Error("Unexpected provider API in test");
  appendFileSync(process.env.LAZADA_TEST_CALLS_FILE, `${JSON.stringify({ method: options.method, path })}\n`);
  const params = Object.fromEntries(new URLSearchParams(options.body ?? url.search));
  const expected = createHmac("sha256", process.env.LAZADA_APP_SECRET).update(path + Object.keys(params)
    .filter(k => k !== "sign").sort().map(k => k + params[k]).join("")).digest("hex").toUpperCase();
  const json = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  if (params.sign !== expected) return json({ code: "IncompleteSignature" });
  if (path === "/auth/token/create") {
    if (params.code === "deny") return json({ code: "InvalidCode", message: "test-only-private-provider-detail" });
    if (params.code === "slow") await setTimeout(250);
    return json({ code: "0", country: params.code === "wrong-country" ? "sg" : "id",
      access_token: "test-only-access-token", refresh_token: "test-only-refresh-token",
      expires_in: 3600, refresh_expires_in: 7200 });
  }
  const control = readFileSync(process.env.LAZADA_TEST_CONTROL_FILE, "utf8");
  if (control === "network") throw new Error("test-only-access-token test-only-private-provider-detail");
  if (control === "revoked") return json({ code: "IllegalAccessToken", message: "test-only-private-provider-detail" });
  if (control === "permission") return json({ code: "InsufficientPermissions", message: "test-only-private-provider-detail" });
  return json({ code: "0", data: { seller_id: "test-only-seller", name: "Dummy fixture, not a real seller" } });
};