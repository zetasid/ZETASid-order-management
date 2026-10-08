// Test-only provider simulation, imported ONLY by the disposable test child process.
// Never loaded by application code. These strings are dummy fixtures, not credentials.
import { appendFileSync, readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { setTimeout } from "node:timers/promises";
const deliveredOrderIds = new Set();
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const path = url.pathname.replace(/^\/rest/, "");
  if (!["https://auth.lazada.com", "https://api.lazada.co.id"].includes(url.origin)
    || !["/auth/token/create", "/seller/get", "/orders/get", "/order/get", "/order/items/get", "/order/digital/delivered",
      "/im/session/list", "/im/session/get", "/im/message/list"].includes(path)) throw new Error("Unexpected provider API in test");
  const params = Object.fromEntries(new URLSearchParams(options.body ?? url.search));
  const call = {
    method: options.method,
    path,
    parameterNames: Object.keys(params).sort(),
    appKey: params.app_key ?? null,
    tokenSource: params.access_token
      ? params.access_token === "test-only-im-access-token" ? "im"
        : ["test-only-access-token", "test-only-orders-token"].includes(params.access_token) ? "seller" : "other"
      : null,
  };
  if (path === "/orders/get") {
    call.createdAfter = params.created_after ?? null;
    call.updateAfter = params.update_after ?? null;
    call.updateBefore = params.update_before ?? null;
  }
  if (path.startsWith("/im/")) {
    call.startTime = params.start_time ?? null;
    call.pageSize = params.page_size ?? null;
    call.cursor = params.last_session_id ?? params.last_message_id ?? null;
  }
  appendFileSync(process.env.LAZADA_TEST_CALLS_FILE, `${JSON.stringify(call)}\n`);
  const appSecret = params.app_key === process.env.LAZADA_IM_APP_KEY
    ? process.env.LAZADA_IM_APP_SECRET : process.env.LAZADA_APP_SECRET;
  const expected = createHmac("sha256", appSecret).update(path + Object.keys(params)
    .filter(k => k !== "sign").sort().map(k => k + params[k]).join("")).digest("hex").toUpperCase();
  const json = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  if (params.sign !== expected) return json({ code: "IncompleteSignature" });
  if (path.startsWith("/im/")) {
    if (options.method !== "GET") throw new Error("IM read endpoints must use GET");
    const control = readFileSync(process.env.LAZADA_TEST_CONTROL_FILE, "utf8");
    if (control === "im-network") throw new Error("test-only-private-provider-detail");
    if (control === "im-permission") return json({
      success: false, err_code: "InsufficientPermissions", err_message: "test-only-permission-detail", data: null,
    });
    const success = data => ({ success: true, err_code: "0", err_message: "SUCCESS", data });
    if (path === "/im/session/list") {
      if (control === "im-malformed") return json(success({ has_more: "yes", session_list: "invalid" }));
      if (control === "im-empty") return json(success({
        has_more: false, next_start_time: null, last_session_id: null, session_list: [],
      }));
      if (control === "im-invalid-session-item") return json(success({
        has_more: false, next_start_time: null, last_session_id: null, session_list: [
          { session_id: "fixture-valid-session", unread_count: 0 },
          {
            session_id: "fixture-session-id-must-not-be-logged",
            summary: "fixture-summary-must-not-be-logged",
            unread_count: "fixture-private-value-must-not-be-logged",
          },
        ],
      }));
      return json(success({
        has_more: true, next_start_time: "1700000001000", last_session_id: "fixture-session-1",
        session_list: [{
          session_id: "fixture-session-1", summary: "synthetic test summary", title: "Synthetic test buyer",
          last_message_id: "fixture-message-1", last_message_time: 1700000000000, unread_count: 1,
          tags: ["fixture"], site_id: "ID",
        }],
      }));
    }
    if (path === "/im/session/get") return json(success({
      session_id: params.session_id, content: "synthetic test summary", title: "Synthetic test buyer",
      last_message_id: "fixture-message-1", last_message_time: 1700000000000, unread_count: 1,
      tags: ["fixture"], site_id: "ID",
    }));
    if (path === "/im/message/list") return json(success({
      has_more: true, next_start_time: "1700000001000", last_message_id: "fixture-message-1",
      message_list: [{
        message_id: "fixture-message-1", content: "{\"txt\":\"synthetic test message\"}",
        from_account_type: 1, send_time: 1700000000000, template_id: 1, to_account_type: 2,
        type: 1, process_msg: "", status: 0, auto_reply: false, site_id: "ID",
        from_account_id: "private-fixture-buyer-id",
      }],
    }));
  }
  if (path === "/auth/token/create") {
    if (params.code === "deny") return json({ code: "InvalidCode", message: "Invalid authorization code", request_id: "test-request-invalid-code" });
    if (params.code === "invalid-response") return json({
      code: "0", country: "id", expires_in: 3600, refresh_expires_in: 7200,
    });
    if (params.code === "slow") await setTimeout(250);
    const isImApp = params.app_key === process.env.LAZADA_IM_APP_KEY;
    return json({ code: "0", country: params.code === "wrong-country" ? "sg" : "id",
      access_token: isImApp ? "test-only-im-access-token" : "test-only-access-token",
      refresh_token: isImApp ? "test-only-im-refresh-token" : "test-only-refresh-token",
      expires_in: 3600, refresh_expires_in: 7200 });
  }
  const control = readFileSync(process.env.LAZADA_TEST_CONTROL_FILE, "utf8");
  if (path === "/order/digital/delivered") {
    if (options.method !== "POST") throw new Error("DeliverDigital must use POST");
    let request;
    try { request = JSON.parse(params.digitalDeliveryReq); } catch { throw new Error("Invalid digital delivery request"); }
    if (!Array.isArray(request?.orders) || request.orders.length !== 1
      || !Number.isSafeInteger(request.orders[0]?.order_id)
      || !Array.isArray(request.orders[0]?.order_item_list)
      || request.orders[0].order_item_list.some(item => !Number.isSafeInteger(item))) {
      throw new Error("Invalid digital delivery request");
    }
    if (control === "delivery-slow") await setTimeout(250);
    const order = request.orders[0];
    const failed = control === "delivery-failure";
    if (!failed) deliveredOrderIds.add(String(order.order_id));
    if (control === "delivery-response-lost" && !failed)
      throw new Error("test-only-private-provider-detail");
    return json({ code: "0", result: { success: true, data: { orders: [{
      order_id: String(order.order_id),
      order_item_list: order.order_item_list.map(order_item_id => ({
        order_item_id: String(order_item_id),
        item_err_code: failed ? "700020" : "0",
        retry: failed,
        msg: failed ? "test-only-private-provider-detail" : "delivered",
      })),
    }] } } });
  }
  if (path === "/orders/get" || path === "/order/get" || path === "/order/items/get") {
    if (options.method !== "GET") throw new Error("Order API must be read-only");
    if (control === "orders-permission") return json({ code: "InsufficientPermissions" });
    const first = process.env.LAZADA_TEST_ORDER_ID;
    const second = String(Number(first) + 1);
    const configuredStatus = id => {
      if (!process.env.LAZADA_TEST_STATUS_FILE) return null;
      try {
        const configured = JSON.parse(readFileSync(process.env.LAZADA_TEST_STATUS_FILE, "utf8"));
        return configured[String(id)] ?? null;
      } catch {
        return null;
      }
    };
    const statusFor = id => {
      if (deliveredOrderIds.has(String(id)) || control === "orders-delivered") return "delivered";
      if (control === "orders-progressed" && String(id) === second) return "packed";
      return configuredStatus(id)?.itemStatus ?? "pending";
    };
    const headerStatusFor = id => {
      if (deliveredOrderIds.has(String(id)) || control === "orders-delivered") return "delivered";
      return configuredStatus(id)?.headerStatus ?? "pending";
    };
    const isDigitalFor = id => {
      const configured = configuredStatus(id);
      if (!configured) return true;
      if (configured.includeIsDigital === false) return undefined;
      return Object.hasOwn(configured, "isDigital") ? configured.isDigital : true;
    };
    const paymentFieldsFor = id => {
      const configured = configuredStatus(id);
      if (!configured) return {};
      return {
        ...(Object.hasOwn(configured, "paymentTime") ? { payment_time: configured.paymentTime } : {}),
        ...(Object.hasOwn(configured, "stagePayStatus") ? { stage_pay_status: configured.stagePayStatus } : {}),
      };
    };
    const order = id => {
      const isOlderOrder = String(id) === second;
      return { order_id: id, order_number: id, items_count: 1, price: "12000.25",
        statuses: [headerStatusFor(id)],
        created_at: isOlderOrder ? "2020-01-15 10:00:00 +0700" : "2026-09-20 10:00:00 +0700",
        updated_at: "2026-09-20 10:01:00 +0700" };
    };
    if (path === "/orders/get") return json({ code: "0", data: { count: 2, countTotal: 2,
      orders: Number(params.offset) ? [] : [order(first), order(second)] } });
    if (path === "/order/get") return json({ code: "0", data: order(params.order_id) });
    if (control === "orders-broken" && params.order_id === second) return json({ code: "0", data: [{
      order_id: "123", order_item_id: second, name: "Dummy", status: "pending",
    }] });
    return json({ code: "0", data: [{
      order_id: params.order_id, order_item_id: String(Number(params.order_id) + 100),
      name: "Dummy phase-eight product, not real seller data", item_price: 12000.25, paid_price: 12000.25,
      variation: "Dummy variation", sku: "test-only-sku", shop_sku: "test-only-shop-sku", currency: "IDR", status: statusFor(params.order_id),
      ...paymentFieldsFor(params.order_id),
      ...(isDigitalFor(params.order_id) === undefined ? {} : { is_digital: isDigitalFor(params.order_id) }),
      product_main_image: "https://images.example.invalid/dummy-product.webp",
      created_at: "2026-09-20 10:00:00 +0700", updated_at: "2026-09-20 10:01:00 +0700",
      extra_attributes: "{\"unmapped_test_field\":\"never invent a digital detail\"}",
      ...(params.order_id === first ? { digital_delivery_info: "{\"test_only_destination\":\"not-real-data\"}" } : {}),
    }] });
  }
  if (control === "network") throw new Error("test-only-access-token test-only-private-provider-detail");
  if (control === "revoked") return json({ code: "IllegalAccessToken", message: "Access token expired", request_id: "test-request-revoked" });
  if (control === "permission") return json({ code: "InsufficientPermissions", message: "Permission denied", request_id: "test-request-permission" });
  return json({ code: "0", data: { seller_id: "test-only-seller", name: "Dummy fixture, not a real seller" } });
};