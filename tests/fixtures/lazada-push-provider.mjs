// Loaded ONLY into the disposable Node test server, never by the deployed app.
import { appendFileSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
const originalFetch = globalThis.fetch;
const id = process.env.LAZADA_TEST_ORDER_ID;
const secondId = String(BigInt(id) + 1n);
const base = new Date(Date.now() - 120000);
const control = () => { try { return readFileSync(process.env.LAZADA_TEST_CONTROL_FILE, "utf8"); } catch { return ""; } };
const header = (orderId, mode) => ({ order_id: orderId, order_number: orderId,
  statuses: [mode === "changed" ? "confirmed" : "pending"], price: "1000.25",
  items_count: orderId === id ? 2 : 1,
  created_at: orderId === secondId ? "2020-01-15 10:00:00 +0700" : base.toISOString(),
  updated_at: new Date(base.getTime() + (mode === "changed" || mode === "progressed" ? 60000 : 0)).toISOString() });
const items = (orderId, mode) => Array.from({ length: orderId === id ? 2 : 1 }, (_, n) => ({
  order_id: orderId, order_item_id: String(BigInt(orderId) * 10n + 100n + BigInt(n)),
  name: "PUSH TEST ONLY", status: mode === "changed" ? "confirmed" : mode === "progressed" ? "packed" : "pending",
  created_at: orderId === secondId ? "2020-01-15 10:00:00 +0700" : base.toISOString(), updated_at: header(orderId, mode).updated_at,
  item_price: "500.125", paid_price: "500.125", currency: "IDR", sku: `test-${n}`, variation: "test",
  extra_attributes: '{"not_the_digital_field":"test-only"}',
  ...(orderId === id ? { digital_delivery_info: n === 0 ? `DUMMY-DEST-${mode || "initial"}` : { test_only_account: "DUMMY-JSON" } } : {}),
}));
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (!url.hostname.startsWith("api.lazada.")) return originalFetch(input, options);
  const path = url.pathname.replace("/rest", "");
  appendFileSync(process.env.LAZADA_TEST_CALLS_FILE, JSON.stringify({ method: options.method,
    path, parameterNames: [...url.searchParams.keys()] }) + "\n");
  const mode = control();
  if (mode === "slow") await delay(700);
  const orderId = url.searchParams.get("order_id");
  let result;
  if (mode === "fail") result = { code: "PermissionDenied" };
  else if (path === "/order/get" && [id, secondId].includes(orderId)) result = { code: "0", data: header(orderId, mode) };
  else if (path === "/order/items/get" && [id, secondId].includes(orderId)) {
    const data = items(orderId, mode);
    if (mode === "broken") data[1] = { ...data[1], order_id: "999" };
    result = { code: "0", data };
  } else if (path === "/orders/get") result = { code: "0", data: { countTotal: 2,
    orders: url.searchParams.get("offset") === "0" ? [header(id, mode), header(secondId, mode)] : [] } };
  else result = { code: "InvalidOrder" };
  return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
};
const worker = await import(process.env.LAZADA_TEST_WORKER_BUNDLE);
process.on("message", async ({ task, taskId }) => {
  try {
    const result = task === "push" ? await worker.importNextPush() : await worker.reconcileOrderPage();
    process.send({ taskId, result });
  } catch { process.send({ taskId, failed: true }); }
});