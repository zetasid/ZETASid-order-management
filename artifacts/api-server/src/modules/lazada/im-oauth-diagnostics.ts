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
  | "network_error"
  | "provider_response_error"
  | "invalid_provider_response"
  | "local_failure"
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
export type ImOAuthDiagnosticDetails = {
  httpStatus?: number;
  providerCode?: string;
  providerRequestId?: string;
};

const stages = new Set<ImOAuthDiagnosticStage>([
  "callback_received", "callback_validation", "state_cookie", "authorization_code",
  "session_check", "token_exchange", "token_validation", "seller_validation",
  "connection_storage", "callback_complete",
]);
const categories = new Set<ImOAuthDiagnosticCategory>([
  "insecure_request", "configuration_unavailable", "cookie_invalid", "state_invalid",
  "state_not_found_expired_or_used", "database_error", "code_missing_or_rejected",
  "session_inactive", "provider_or_transport_error", "network_error", "provider_response_error",
  "invalid_provider_response", "local_failure", "invalid_token_response",
  "wrong_country", "seller_identity_invalid", "expiry_invalid", "seller_conflict",
  "storage_error", "unexpected_error",
]);
const correlationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeProviderIdentifier = (value: string, maxLength: number) =>
  value.length <= maxLength && /^[A-Za-z0-9_.-]+$/.test(value)
  && !/(?:secret|access.?token|refresh.?token|seller|cookie|state|authorization)/i.test(value);

/** Emits only allowlisted diagnostic metadata. Logging must never affect OAuth behavior. */
export function logImOAuthDiagnostic(
  logger: ImOAuthDiagnosticLogger,
  correlationId: string,
  stage: ImOAuthDiagnosticStage,
  result: "started" | "succeeded" | "failed",
  category?: ImOAuthDiagnosticCategory,
  details?: ImOAuthDiagnosticDetails,
): void {
  if (!correlationIdPattern.test(correlationId) || !stages.has(stage)
    || !["started", "succeeded", "failed"].includes(result)
    || (category !== undefined && !categories.has(category))) return;
  const fields: Record<string, string> = { correlationId, stage, result };
  if (category) fields.category = category;
  if (details?.httpStatus !== undefined && Number.isInteger(details.httpStatus)
    && details.httpStatus >= 100 && details.httpStatus <= 599)
    fields.httpStatus = String(details.httpStatus);
  if (details?.providerCode && safeProviderIdentifier(details.providerCode, 64))
    fields.providerCode = details.providerCode;
  if (details?.providerRequestId && safeProviderIdentifier(details.providerRequestId, 96))
    fields.providerRequestId = details.providerRequestId;
  try {
    logger.info(fields, "Lazada IM OAuth diagnostic");
  } catch {
    // A diagnostic sink failure must not change the OAuth flow.
  }
}
