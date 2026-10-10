import { randomUUID } from "node:crypto";
import { Router, type CookieOptions } from "express";
import { LazadaError } from "../modules/lazada/client";
import {
  logImOAuthDiagnostic,
  type ImOAuthDiagnosticCategory,
  type ImOAuthDiagnosticDetails,
  type ImOAuthDiagnosticStage,
} from "../modules/lazada/im-oauth-diagnostics";
import { resolveLazadaOAuthFlow, type OAuthStateMatches } from "../modules/lazada/oauth-state-dispatch";
import { validNonce, type LazadaConfig } from "../modules/lazada/security";

const sellerCookie = "zetas_lazada_oauth";
const imCookie = "zetas_lazada_im_oauth";
const cookieOptions: CookieOptions = {
  httpOnly: true, secure: true, sameSite: "lax", path: "/api/lazada/oauth/callback",
};
type Flow = "seller" | "im";

export type LazadaOAuthCallbackDependencies = {
  lookupState: (state: string) => Promise<OAuthStateMatches>;
  sellerConfig: () => LazadaConfig | null;
  imConfig: () => LazadaConfig | null;
  isSellerState: (state: unknown) => state is string;
  isImState: (state: unknown) => state is string;
  finishSeller: (config: LazadaConfig, state: string, browser: string, code: string | null) => Promise<void>;
  finishIm: (
    config: LazadaConfig,
    state: string,
    browser: string,
    code: string | null,
    diagnostic: (stage: ImOAuthDiagnosticStage, result: "started" | "succeeded" | "failed",
      category?: ImOAuthDiagnosticCategory, details?: ImOAuthDiagnosticDetails) => void,
  ) => Promise<void>;
};

export function createLazadaOAuthCallbackRouter(deps: LazadaOAuthCallbackDependencies) {
  const router = Router();
  router.get("/lazada/oauth/callback", async (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    if (!req.secure) {
      res.redirect(303, "/settings");
      return;
    }
    const sellerConfig = deps.sellerConfig();
    const imConfig = deps.imConfig();
    const sellerStateShape = deps.isSellerState(req.query.state);
    const imStateShape = deps.isImState(req.query.state);
    if ((!sellerStateShape && !imStateShape)
      || (sellerStateShape && !sellerConfig)
      || (imStateShape && !imConfig)) {
      res.redirect(303, "/settings");
      return;
    }
    let flow;
    try {
      flow = await resolveLazadaOAuthFlow(req.query.state, deps.lookupState);
    } catch {
      flow = "unknown";
    }
    if (flow === "ambiguous" || flow === "unknown") {
      res.redirect(303, "/settings");
      return;
    }
    if (flow === "im") {
      const browser: unknown = req.cookies?.[imCookie];
      const correlationId = randomUUID();
      const diagnostic = (stage: ImOAuthDiagnosticStage, result: "started" | "succeeded" | "failed",
        category?: ImOAuthDiagnosticCategory, details?: ImOAuthDiagnosticDetails) =>
        logImOAuthDiagnostic(req.log, correlationId, stage, result, category, details);
      diagnostic("callback_received", "started");
      let outcome = "authorization_failed";
      try {
        if (!deps.isImState(req.query.state)) {
          diagnostic("state_cookie", "failed", "state_invalid");
          throw new LazadaError("authorization_failed");
        }
        if (!imConfig) {
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
        await deps.finishIm(imConfig, req.query.state, browser, code, diagnostic);
        outcome = "connected";
        diagnostic("callback_complete", "succeeded");
      } catch (error) {
        if (error instanceof LazadaError) outcome = error.reason;
        diagnostic("callback_complete", "failed");
        req.log.warn({ outcome, correlationId }, "Lazada IM authorization not completed");
      }
      res.clearCookie(imCookie, cookieOptions);
      res.redirect(303, `/settings?lazada_im=${outcome}`);
      return;
    }
    const browser: unknown = req.cookies?.[sellerCookie];
    let outcome = "authorization_failed";
    try {
      if (!sellerConfig || !deps.isSellerState(req.query.state) || !validNonce(browser))
        throw new LazadaError("authorization_failed");
      const code = typeof req.query.code === "string" && req.query.code.length > 0 && req.query.code.length <= 2048
        && !req.query.error ? req.query.code : null;
      await deps.finishSeller(sellerConfig, req.query.state, browser, code);
      outcome = "connected";
    } catch (error) {
      if (error instanceof LazadaError) outcome = error.reason;
      req.log.warn({ outcome }, "Lazada authorization not completed");
    }
    res.clearCookie(sellerCookie, cookieOptions);
    res.redirect(303, `/settings?lazada=${outcome}`);
  });
  return router;
}
