import { eq } from "drizzle-orm";
import { Router, type CookieOptions } from "express";
import { db, lazadaImOauthStatesTable, lazadaOauthStatesTable } from "@workspace/db";
import { GetLazadaConnectionResponse, CheckLazadaConnectionResponse, SyncLazadaOrdersBody, SyncLazadaOrdersResponse } from "@workspace/api-zod";
import { checkConnection, connectionStatus, finishAuthorization, isSellerOAuthState, startAuthorization } from "../modules/lazada/connection";
import { configuration, hash, imConfiguration } from "../modules/lazada/security";
import { LazadaError } from "../modules/lazada/client";
import { syncOrders } from "../modules/lazada/order-sync";
import { finishImAuthorization, isImOAuthState } from "../modules/lazada/im-connection";
import { createLazadaOAuthCallbackRouter } from "./lazada-oauth-callback";

const BROWSER_COOKIE = "zetas_lazada_oauth";
const options: CookieOptions = { httpOnly: true, secure: true, sameSite: "lax", path: "/api/lazada/oauth/callback" };
export const lazadaRouter = Router();
export const lazadaCallbackRouter = createLazadaOAuthCallbackRouter({
  sellerConfig: configuration,
  imConfig: imConfiguration,
  isSellerState: isSellerOAuthState,
  isImState: isImOAuthState,
  finishSeller: finishAuthorization,
  finishIm: finishImAuthorization,
  lookupState: async state => {
    const stateHash = hash(state);
    const [sellerStates, imStates] = await Promise.all([
      db.select({ stateHash: lazadaOauthStatesTable.stateHash }).from(lazadaOauthStatesTable)
        .where(eq(lazadaOauthStatesTable.stateHash, stateHash)).limit(1),
      db.select({ stateHash: lazadaImOauthStatesTable.stateHash }).from(lazadaImOauthStatesTable)
        .where(eq(lazadaImOauthStatesTable.stateHash, stateHash)).limit(1),
    ]);
    return { seller: sellerStates.length > 0, im: imStates.length > 0 };
  },
});

lazadaRouter.post("/lazada/orders/sync", async (req, res) => {
  const input = SyncLazadaOrdersBody.safeParse(req.body);
  if (!input.success || !req.secure || new Date(input.data.createdAfter) > new Date(input.data.createdBefore)
    || new Date(input.data.createdBefore).getTime() - new Date(input.data.createdAfter).getTime() > 366 * 86400000) {
    res.status(400).json({ error: "Rentang tanggal tidak valid (maksimum 366 hari), atau koneksi bukan HTTPS." }); return;
  }
  if (!configuration()) { res.status(503).json({ error: "Konfigurasi Lazada Testing belum lengkap." }); return; }
  try {
    res.json(SyncLazadaOrdersResponse.parse(await syncOrders(res.locals.auth.user.id, res.locals.auth.tokenHash, {
      createdAfter: input.data.createdAfter.toISOString(), createdBefore: input.data.createdBefore.toISOString(), offset: input.data.offset,
    })));
  } catch (error) {
    const reason = error instanceof LazadaError ? error.reason : "api_unavailable";
    const messages = {
      authorization_failed: "Koneksi Lazada tidak valid atau kedaluwarsa. Hubungkan ulang di Pengaturan.",
      permission_denied: "Lazada menolak izin baca. Aktifkan hanya GetOrders dan GetOrderItems di App Console.",
      invalid_response: "Response Lazada tidak lengkap atau formatnya tidak valid. Halaman ini tidak disimpan.",
      sync_busy: "Sinkronisasi manual lain sedang berjalan. Tunggu hingga selesai.",
      api_unavailable: "Pembacaan Lazada gagal. Data halaman ini tidak disimpan; silakan coba lagi.",
      wrong_country: "Negara toko tidak sesuai dengan konfigurasi.",
    };
    res.status(reason === "authorization_failed" || reason === "sync_busy" ? 409 : 502).json({ error: messages[reason] });
  }
});

lazadaRouter.get("/lazada/connection", async (_req, res) => {
  res.json(GetLazadaConnectionResponse.parse(await connectionStatus(res.locals.auth.user.id)));
});
lazadaRouter.post("/lazada/oauth/authorize", async (req, res) => {
  const config = configuration();
  if (!config) { res.status(503).json({ error: "Konfigurasi Lazada Testing belum lengkap atau tidak valid." }); return; }
  if (!req.secure) { res.status(400).json({ error: "OAuth Lazada hanya dapat dimulai melalui HTTPS." }); return; }
  const result = await startAuthorization(config, res.locals.auth.user.id, res.locals.auth.tokenHash);
  res.cookie(BROWSER_COOKIE, result.browser, { ...options, maxAge: 10 * 60_000 });
  res.set("Referrer-Policy", "no-referrer").json({ authorizationUrl: result.authorizationUrl });
});
lazadaRouter.post("/lazada/check", async (_req, res) => {
  if (!configuration()) { res.status(503).json({ error: "Konfigurasi Lazada Testing belum lengkap atau tidak valid." }); return; }
  try {
    res.json(CheckLazadaConnectionResponse.parse(await checkConnection(res.locals.auth.user.id)));
  } catch (error) {
    const reason = error instanceof LazadaError ? error.reason : "api_unavailable";
    res.status(reason === "authorization_failed" ? 409 : 502).json({ error: reason === "permission_denied"
      ? "Akses GetSeller belum diizinkan. Periksa permission minimum di App Console."
      : reason === "authorization_failed" ? "Koneksi tidak valid atau token kedaluwarsa. Hubungkan ulang Lazada."
      : "Lazada tidak dapat dihubungi. Coba cek koneksi kembali." });
  }
});