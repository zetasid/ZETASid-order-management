export type ImOAuthDiagnosticStage =
  | "callback_received"
  | "callback_validation"
  | "state_cookie"
  | "authorization_code"
  | "session_check"
  | "token_exchange"
  | "token_validation"
  | "seller_validation"
  | "connection_storage"
  | "callback_complete";

export type ImOAuthDiagnosticCategory =
  | "insecure_request"
  | "configuration_unavailable"
  | "cookie_invalid"
  | "state_invalid"
  | "state_not_found_expired_or_used"
  | "database_error"
  | "code_missing_or_rejected"
  | "session_inactive"
  | "provider_or_transport_error"
  | "invalid_token_response"
  | "wrong_country"
  | "seller_identity_invalid"
  | "expiry_invalid"
  | "seller_conflict"
  | "storage_error"
  | "unexpected_error";

export type ImOAuthDiagnosticLogger = {
  info(fields: Record<string, string>, message: string): void;
};

const stages = new Set<ImOAuthDiagnosticStage>([
  "callback_received", "callback_validation", "state_cookie", "authorization_code",
  "session_check", "token_exchange", "token_validation", "seller_validation",
  "connection_storage", "callback_complete",
]);
const categories = new Set<ImOAuthDiagnosticCategory>([
  "insecure_request", "configuration_unavailable", "cookie_invalid", "state_invalid",
  "state_not_found_expired_or_used", "database_error", "code_missing_or_rejected",
  "session_inactive", "provider_or_transport_error", "invalid_token_response",
  "wrong_country", "seller_identity_invalid", "expiry_invalid", "seller_conflict",
  "storage_error", "unexpected_error",
]);

/** Emits only allowlisted diagnostic metadata. Logging must never affect OAuth behavior. */
export function logImOAuthDiagnostic(
  logger: ImOAuthDiagnosticLogger,
  correlationId: string,
  stage: ImOAuthDiagnosticStage,
  result: "started" | "succeeded" | "failed",
  category?: ImOAuthDiagnosticCategory,
): void {
  if (!stages.has(stage) || (category !== undefined && !categories.has(category))) return;
  const fields: Record<string, string> = { correlationId, stage, result };
  if (category) fields.category = category;
  try {
    logger.info(fields, "Lazada IM OAuth diagnostic");
  } catch {
    // A diagnostic sink failure must not change the OAuth flow.
  }
}
