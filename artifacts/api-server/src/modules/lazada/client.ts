import { createHmac } from "node:crypto";
import { endpoints, type LazadaConfig } from "./security";

export class LazadaError extends Error {
  constructor(public readonly reason: "authorization_failed" | "permission_denied" | "api_unavailable" | "wrong_country") {
    super(reason);
  }
}
export function signature(path: string, params: Record<string, string>, secret: string): string {
  const message = path + Object.keys(params).filter(k => k !== "sign").sort().map(k => k + params[k]).join("");
  return createHmac("sha256", secret).update(message, "utf8").digest("hex").toUpperCase();
}
// Deliberately NOT a generic Lazada client: this phase can only call these two APIs.
export function createClient(config: LazadaConfig, transport: typeof fetch = fetch) {
  async function call(path: "/auth/token/create" | "/seller/get", business: Record<string, string>) {
    const params = { ...business, app_key: config.appKey, sign_method: "sha256", timestamp: String(Date.now()) };
    const signed = new URLSearchParams({ ...params, sign: signature(path, params, config.appSecret) });
    const url = new URL((path === "/auth/token/create" ? "https://auth.lazada.com/rest" : endpoints[config.country]) + path);
    const tokenRequest = path === "/auth/token/create";
    if (!tokenRequest) url.search = signed.toString();
    try {
      const response = await transport(url, { method: tokenRequest ? "POST" : "GET", redirect: "error",
        signal: AbortSignal.timeout(10_000),
        ...(tokenRequest ? { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: signed.toString() } : {}) });
      // Limit provider payloads. Raw bodies/URLs/errors never reach logs or API responses.
      const text = await response.text();
      if (text.length > 128_000) throw new LazadaError("api_unavailable");
      const body = JSON.parse(text);
      if (!body || typeof body !== "object" || !response.ok) throw new LazadaError("api_unavailable");
      if (String(body.code) !== "0") {
        const code = String(body.code);
        throw new LazadaError(/IllegalAccessToken|InvalidAccessToken|InvalidCode|TokenExpired/i.test(code)
          ? "authorization_failed" : /Permission|Forbidden|AccessDenied|Scope/i.test(code) ? "permission_denied" : "api_unavailable");
      }
      return body;
    } catch (error) {
      if (error instanceof LazadaError) throw error;
      throw new LazadaError("api_unavailable");
    }
  }
  return {
    async exchange(code: string) {
      const body = await call("/auth/token/create", { code });
      const validToken = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 8192;
      const duration = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= 366 * 86400;
      if (!validToken(body.access_token) || !validToken(body.refresh_token)
        || !duration(body.expires_in) || !duration(body.refresh_expires_in)) throw new LazadaError("authorization_failed");
      const countries = Array.isArray(body.country_user_info) ? body.country_user_info : [];
      if (body.country !== config.country && !countries.some((c: { country?: string }) => c?.country === config.country))
        throw new LazadaError("wrong_country");
      return { accessToken: body.access_token as string, refreshToken: body.refresh_token as string,
        expiresIn: body.expires_in as number, refreshExpiresIn: body.refresh_expires_in as number };
    },
    async check(accessToken: string) {
      const body = await call("/seller/get", { access_token: accessToken });
      if (!body.data || typeof body.data !== "object" || Array.isArray(body.data))
        throw new LazadaError("api_unavailable");
      // Only success is retained; no seller PII or business data is returned/stored.
    },
  };
}