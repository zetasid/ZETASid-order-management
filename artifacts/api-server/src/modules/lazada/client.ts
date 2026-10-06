import { createHmac } from "node:crypto";
import { logger } from "../../lib/logger";
import { endpoints, type LazadaConfig } from "./security";

export class LazadaError extends Error {
  constructor(public readonly reason: "authorization_failed" | "permission_denied" | "api_unavailable" | "wrong_country" | "invalid_response" | "sync_busy") {
    super(reason);
  }
}

export type DigitalDeliveryItemResult = {
  orderId: string;
  orderItemId: string;
  itemErrorCode: string;
  retry: boolean;
};

export function signature(path: string, params: Record<string, string>, secret: string): string {
  const message = path + Object.keys(params).filter(k => k !== "sign").sort().map(k => k + params[k]).join("");
  return createHmac("sha256", secret).update(message, "utf8").digest("hex").toUpperCase();
}

type DiagnosticLogger = Pick<typeof logger, "warn">;

function safeDiagnosticValue(value: unknown, sensitiveValues: readonly string[]): string | number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  let result = String(value).slice(0, 512);
  for (const sensitive of sensitiveValues) {
    if (sensitive) result = result.split(sensitive).join("[redacted]");
  }
  return result
    .replace(/https?(?::|%3a)(?:\/|%2f){2}[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/\b(access_token|refresh_token|app_secret|app_key|code|sign|timestamp)(?:=|%3d)[^&\s"'<>]*/gi,
      "$1=[redacted]");
}

function logFailedResponse(
  diagnosticLogger: DiagnosticLogger,
  path: string,
  httpStatus: number | null,
  body: unknown,
  sensitiveValues: readonly string[],
) {
  const responseBody = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown> : {};
  diagnosticLogger.warn({
    path,
    httpStatus,
    providerCode: safeDiagnosticValue(responseBody.code, sensitiveValues),
    providerMessage: safeDiagnosticValue(responseBody.message, sensitiveValues),
    providerRequestId: safeDiagnosticValue(responseBody.request_id, sensitiveValues),
  }, "Lazada API response failed");
}

// Explicit allowlist: OAuth, seller verification, order reads and manual digital delivery only.
export function createClient(config: LazadaConfig, transport: typeof fetch = fetch, signal?: AbortSignal,
  diagnosticLogger: DiagnosticLogger = logger) {
  async function call(path: "/auth/token/create" | "/seller/get" | "/orders/get" | "/order/get" | "/order/items/get" | "/order/digital/delivered",
    business: Record<string, string>, method?: "GET" | "POST") {
    const params = { ...business, app_key: config.appKey, sign_method: "sha256", timestamp: String(Date.now()) };
    const signed = new URLSearchParams({ ...params, sign: signature(path, params, config.appSecret) });
    const sensitiveValues = [...Object.values(params), config.appSecret, signed.get("sign") ?? ""];
    const url = new URL((path === "/auth/token/create" ? "https://auth.lazada.com/rest" : endpoints[config.country]) + path);
    const tokenRequest = path === "/auth/token/create";
    const requestMethod = method ?? (tokenRequest ? "POST" : "GET");
    if (!tokenRequest && requestMethod === "GET") url.search = signed.toString();
    let httpStatus: number | null = null;
    let diagnosticLogged = false;
    const logFailure = (body: unknown = null) => {
      logFailedResponse(diagnosticLogger, path, httpStatus, body, sensitiveValues);
      diagnosticLogged = true;
    };
    try {
      const response = await transport(url, { method: requestMethod, redirect: "error",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
        ...(requestMethod === "POST" ? { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: signed.toString() } : {}) });
      httpStatus = response.status;
      // Limit provider payloads. Raw bodies/URLs/errors never reach logs or API responses.
      const text = await response.text();
      if (text.length > 2_000_000) {
        logFailure();
        throw new LazadaError("api_unavailable");
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        logFailure();
        throw new LazadaError("api_unavailable");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        logFailure();
        throw new LazadaError("api_unavailable");
      }
      if (!response.ok) {
        logFailure(body);
        throw new LazadaError("api_unavailable");
      }
      const responseBody = body as Record<string, unknown>;
      if (String(responseBody.code) !== "0") {
        logFailure(responseBody);
        const code = String(responseBody.code);
        throw new LazadaError(/IllegalAccessToken|InvalidAccessToken|InvalidCode|TokenExpired/i.test(code)
          ? "authorization_failed" : /Permission|Forbidden|AccessDenied|Scope/i.test(code) ? "permission_denied" : "api_unavailable");
      }
      return responseBody;
    } catch (error) {
      if (error instanceof LazadaError) throw error;
      if (!diagnosticLogged) logFailure();
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
    async getOrders(accessToken: string, filters: { createdAfter: string; createdBefore: string; offset: number; limit: number }) {
      const body = await call("/orders/get", { access_token: accessToken, created_after: filters.createdAfter,
        created_before: filters.createdBefore, offset: String(filters.offset), limit: String(filters.limit),
        sort_by: "created_at", sort_direction: "ASC" });
      if (!body.data || !Array.isArray(body.data.orders)
        || body.data.orders.some((order: unknown) => !order || typeof order !== "object" || Array.isArray(order)))
        throw new LazadaError("invalid_response");
      return { orders: body.data.orders as Record<string, unknown>[],
        countTotal: Number.isSafeInteger(body.data.countTotal) && body.data.countTotal >= 0 ? body.data.countTotal as number : null,
        responseFields: Object.keys(body), dataFields: Object.keys(body.data) };
    },
    async getOrderItems(accessToken: string, orderId: string) {
      const body = await call("/order/items/get", { access_token: accessToken, order_id: orderId });
      if (!Array.isArray(body.data)
        || body.data.some((item: unknown) => !item || typeof item !== "object" || Array.isArray(item)))
        throw new LazadaError("invalid_response");
      return { items: body.data as Record<string, unknown>[], responseFields: Object.keys(body) };
    },
    async getOrder(accessToken: string, orderId: string) {
      const body = await call("/order/get", { access_token: accessToken, order_id: orderId });
      if (!body.data || typeof body.data !== "object" || Array.isArray(body.data))
        throw new LazadaError("invalid_response");
      return body.data as Record<string, unknown>;
    },
    async deliverDigital(accessToken: string, orderId: string, orderItemIds: string[]) {
      const providerNumber = (value: string) => {
        const number = Number(value);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number <= 0)
          throw new LazadaError("invalid_response");
        return number;
      };
      const body = await call("/order/digital/delivered", {
        access_token: accessToken,
        digitalDeliveryReq: JSON.stringify({ orders: [{
          order_id: providerNumber(orderId),
          order_item_list: orderItemIds.map(providerNumber),
        }] }),
      }, "POST");
      const envelope = body.result;
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
        throw new LazadaError("invalid_response");
      const successValue = (envelope as Record<string, unknown>).success;
      const success = successValue === true || successValue === "true";
      if (!success) {
        if (successValue !== false && successValue !== "false") throw new LazadaError("invalid_response");
        return { success: false, items: [] as DigitalDeliveryItemResult[] };
      }
      const data = (envelope as Record<string, unknown>).data;
      const orders = data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>).orders : null;
      if (!Array.isArray(orders) || orders.length !== 1
        || !orders[0] || typeof orders[0] !== "object" || Array.isArray(orders[0]))
        throw new LazadaError("invalid_response");
      const order = orders[0] as Record<string, unknown>;
      const id = (value: unknown): string | null => {
        if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
        if (typeof value === "string" && /^\d+$/.test(value)
          && Number.isSafeInteger(Number(value)) && Number(value) > 0) return String(Number(value));
        return null;
      };
      const responseOrderId = id(order.order_id);
      if (!responseOrderId || !Array.isArray(order.order_item_list))
        throw new LazadaError("invalid_response");
      const items = order.order_item_list.map((value: unknown): DigitalDeliveryItemResult => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new LazadaError("invalid_response");
        const item = value as Record<string, unknown>;
        const orderItemId = id(item.order_item_id);
        const errorCode = typeof item.item_err_code === "string" || typeof item.item_err_code === "number"
          ? String(item.item_err_code) : null;
        const retry = typeof item.retry === "boolean" ? item.retry
          : item.retry === "true" ? true : item.retry === "false" ? false : null;
        if (!orderItemId || errorCode === null || retry === null)
          throw new LazadaError("invalid_response");
        return { orderId: responseOrderId, orderItemId, itemErrorCode: errorCode, retry };
      });
      return { success: true, items };
    },
    async getUpdatedOrders(accessToken: string, filters: { after: string; before: string; offset: number; limit: number }) {
      const body = await call("/orders/get", { access_token: accessToken, update_after: filters.after,
        update_before: filters.before, offset: String(filters.offset), limit: String(filters.limit),
        sort_by: "updated_at", sort_direction: "ASC" });
      if (!body.data || !Array.isArray(body.data.orders)
        || body.data.orders.some((order: unknown) => !order || typeof order !== "object" || Array.isArray(order)))
        throw new LazadaError("invalid_response");
      return { orders: body.data.orders as Record<string, unknown>[],
        countTotal: Number.isSafeInteger(body.data.countTotal) && body.data.countTotal >= 0 ? body.data.countTotal as number : null };
    },
  };
}