import { randomUUID } from "node:crypto";
import { Router, type CookieOptions } from "express";
import { GetLazadaConnectionResponse, CheckLazadaConnectionResponse, SyncLazadaOrdersBody, SyncLazadaOrdersResponse } from "@workspace/api-zod";
import { checkConnection, connectionStatus, finishAuthorization, startAuthorization } from "../modules/lazada/connection";
import { configuration, imConfiguration, validNonce, type LazadaConfig } from "../modules/lazada/security";
import { LazadaError } from "../modules/lazada/client";
import {
  dispatchLazadaOAuthCallback,
  logImOAuthDiagnostic,
  type ImOAuthDiagnosticDetails,
} from "../modules/lazada/im-oauth-diagnostics";
import { syncOrders } from "../modules/lazada/order-sync";
import {
  finishImAuthorization,
  imOAuthCookieName,
  isImOAuthState,
} from "../modules/lazada/im-connection";

const BROWSER_COOKIE = "zetas_lazada_oauth";
const options: CookieOptions = { httpOnly: true, secure: true, sameSite: "lax", path: "/api/lazada/oauth/callback" };
export const lazadaCallbackRouter = Router();
export const lazadaRouter = Router();

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

lazadaCallbackRouter.get("/lazada/oauth/callback", async (req, res) => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  if (dispatchLazadaOAuthCallback(req.query.state, () => true, () => false)) {
    const browser: unknown = req.cookies?.[imOAuthCookieName];
    const correlationId = randomUUID();
    const diagnostic = (stage: Parameters<typeof logImOAuthDiagnostic>[2],
      result: Parameters<typeof logImOAuthDiagnostic>[3],
      category?: Parameters<typeof logImOAuthDiagnostic>[4],
      details?: ImOAuthDiagnosticDetails) =>
      logImOAuthDiagnostic(req.log, correlationId, stage, result, category, details);
    diagnostic("callback_received", "started");
    let outcome = "authorization_failed";
    try {
      if (!isImOAuthState(req.query.state)) {
        diagnostic("state_cookie", "failed", "state_invalid");
        throw new LazadaError("authorization_failed");
      }
      const config: LazadaConfig | null = imConfiguration();
      if (!req.secure) {
        diagnostic("callback_validation", "failed", "insecure_request");
        throw new LazadaError("authorization_failed");
      }
      if (!config) {
        diagnostic("callback_validation", "failed", "configuration_unavailable");
        throw new LazadaError("authorization_failed");
      }
      diagnostic("callback_validation", "succeeded");
      if (!validNonce(browser)) {
        diagnostic("state_cookie", "failed", "cookie_invalid");
        throw new LazadaError("authorization_failed");
      }
      const code = typeof req.query.code === "string" && req.query.code.length > 0 && req.query.code.length <= 2048
        && !req.query.error ? req.query.code : null;
      await finishImAuthorization(config, req.query.state, browser, code, diagnostic);
      outcome = "connected";
      diagnostic("callback_complete", "succeeded");
    } catch (error) {
      if (error instanceof LazadaError) outcome = error.reason;
      diagnostic("callback_complete", "failed");
      req.log.warn({ outcome, correlationId }, "Lazada IM authorization not completed");
    }
    res.clearCookie(imOAuthCookieName, options);
    res.redirect(303, `/settings?lazada_im=${outcome}`);
    return;
  }

  const config = configuration();
  const browser: unknown = req.cookies?.[BROWSER_COOKIE];
  let outcome = "authorization_failed";
  try {
    if (!req.secure || !config || !validNonce(req.query.state) || !validNonce(browser))
      throw new LazadaError("authorization_failed");
    const code = typeof req.query.code === "string" && req.query.code.length > 0 && req.query.code.length <= 2048
      && !req.query.error ? req.query.code : null;
    await finishAuthorization(config, req.query.state, browser, code);
    outcome = "connected";
  } catch (error) {
    if (error instanceof LazadaError) outcome = error.reason;
    // Do not log the exception, provider response, code, state, cookies or token.
    req.log.warn({ outcome }, "Lazada authorization not completed");
  }
  res.clearCookie(BROWSER_COOKIE, options);
  // Same-origin relative redirect; no provider data is reflected to the frontend.
  res.redirect(303, `/settings?lazada=${outcome}`);
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