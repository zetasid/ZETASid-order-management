import { LazadaError, signature } from "./client";
import { logger } from "../../lib/logger";
import { endpoints, type LazadaConfig } from "./security";

const MAX_PAGE_SIZE = 20;
const MAX_RESPONSE_LENGTH = 2_000_000;
const sessionPath = "/im/session/list";
const detailPath = "/im/session/get";
const messagesPath = "/im/message/list";

export type ImPageInput = {
  startTime: string;
  pageSize: number;
  cursor?: string;
};

export type ImSession = {
  session_id: string;
  summary?: string;
  content?: string;
  title?: string;
  last_message_id?: string;
  last_message_time?: string;
  unread_count?: number;
  self_position?: string;
  to_position?: string;
  tags?: string[];
  site_id?: string;
};

export type ImMessage = {
  message_id: string;
  content?: string;
  from_account_type?: number;
  send_time?: string;
  template_id?: number;
  to_account_type?: number;
  type?: number;
  process_msg?: string;
  status?: number;
  auto_reply?: boolean;
  site_id?: string;
};

type JsonRecord = Record<string, unknown>;

type ImProviderResponse = {
  path: typeof sessionPath | typeof detailPath | typeof messagesPath;
  httpStatus: number | null;
  body: JsonRecord;
  data: JsonRecord;
  sensitiveValues: readonly string[];
};

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeDiagnosticValue(value: unknown, sensitiveValues: readonly string[]): string | number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  let result = String(value);
  for (const sensitive of sensitiveValues) {
    if (!sensitive) continue;
    const encoded = encodeURIComponent(sensitive);
    const formEncoded = new URLSearchParams({ value: sensitive }).toString().slice("value=".length);
    for (const variant of new Set([sensitive, encoded, formEncoded])) {
      if (variant) result = result.split(variant).join("[redacted]");
    }
  }
  return result
    .replace(/https?(?::|%3a)(?:\/|%2f){2}[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/\b(access_token|refresh_token|app_secret|app_key|code|sign|timestamp|session_id|last_session_id|last_message_id)(?:=|%3d)[^&\s"'<>]*/gi,
      "$1=[redacted]")
    .slice(0, 512);
}

function logProviderFailure(
  path: typeof sessionPath | typeof detailPath | typeof messagesPath,
  httpStatus: number | null,
  body: unknown,
  sensitiveValues: readonly string[],
) {
  const responseBody = isRecord(body) ? body : {};
  logger.warn({
    path,
    httpStatus,
    providerCode: safeDiagnosticValue(responseErrorCode(responseBody), sensitiveValues),
    providerMessage: safeDiagnosticValue(responseBody.err_message ?? responseBody.message, sensitiveValues),
    providerRequestId: safeDiagnosticValue(responseBody.request_id, sensitiveValues),
  }, "Lazada IM API response failed");
}

function logSessionListDataStructure(data: unknown) {
  const source = isRecord(data) ? data : null;
  const sessionList = source?.session_list;
  const hasSessionList = Array.isArray(sessionList);
  const firstItem = hasSessionList ? sessionList[0] : undefined;
  const hasFirstItem = hasSessionList && sessionList.length > 0;
  logger.warn({
    path: sessionPath,
    dataType: Array.isArray(data) ? "array" : typeof data,
    dataKeys: source ? Object.keys(source) : [],
    hasMoreType: source ? typeof source.has_more : "undefined",
    sessionListType: hasSessionList ? "array" : typeof sessionList,
    nextStartTimeType: source ? typeof source.next_start_time : "undefined",
    lastSessionIdType: source ? typeof source.last_session_id : "undefined",
    ...(hasSessionList ? { sessionListLength: sessionList.length } : {}),
    ...(hasFirstItem ? {
      firstItemType: typeof firstItem,
      firstItemKeys: isRecord(firstItem) ? Object.keys(firstItem) : [],
    } : {}),
  }, "Lazada IM data structure diagnostic");
}

function parseProviderData<T>(response: ImProviderResponse, parse: (data: JsonRecord) => T): T {
  try {
    return parse(response.data);
  } catch (error) {
    if (error instanceof LazadaError && error.reason === "invalid_response") {
      logProviderFailure(response.path, response.httpStatus, response.body, response.sensitiveValues);
      if (response.path === sessionPath) logSessionListDataStructure(response.data);
    }
    throw error;
  }
}

function requiredText(value: unknown, maxLength = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength)
    throw new LazadaError("invalid_response");
  return value;
}

function optionalText(source: JsonRecord, key: string, maxLength = 4096): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > maxLength) throw new LazadaError("invalid_response");
  return value;
}

function optionalNumber(source: JsonRecord, key: string): number | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new LazadaError("invalid_response");
  return value;
}

function optionalTimestamp(source: JsonRecord, key: string): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new LazadaError("invalid_response");
  const timestamp = typeof value === "number" ? String(value) : value;
  if (typeof timestamp !== "string" || !/^\d{1,16}$/.test(timestamp)
    || !Number.isSafeInteger(Number(timestamp)) || Number(timestamp) <= 0) throw new LazadaError("invalid_response");
  return timestamp;
}

function optionalBoolean(source: JsonRecord, key: string): boolean | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new LazadaError("invalid_response");
  return value;
}

function optionalTags(source: JsonRecord): string[] | undefined {
  const value = source.tags;
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 50
    || value.some(tag => typeof tag !== "string" || tag.length > 128)) throw new LazadaError("invalid_response");
  return value as string[];
}

const sessionDiagnosticFieldNames = [
  "session_id",
  "summary",
  "unread_count",
  "last_message_id",
  "head_url",
  "self_position",
  "last_message_time",
  "site_id",
  "title",
  "buyer_id",
  "to_position",
  "tags",
] as const;

const sessionDiagnosticValidators: {
  field: typeof sessionDiagnosticFieldNames[number];
  validator: "requiredText" | "optionalText" | "optionalNumber" | "optionalTimestamp" | "optionalTags";
  validate: (source: JsonRecord) => unknown;
}[] = [
  { field: "session_id", validator: "requiredText", validate: source => requiredText(source.session_id) },
  { field: "summary", validator: "optionalText", validate: source => optionalText(source, "summary") },
  { field: "unread_count", validator: "optionalNumber", validate: source => optionalNumber(source, "unread_count") },
  { field: "last_message_id", validator: "optionalText", validate: source => optionalText(source, "last_message_id") },
  { field: "self_position", validator: "optionalTimestamp", validate: source => optionalTimestamp(source, "self_position") },
  { field: "last_message_time", validator: "optionalTimestamp", validate: source => optionalTimestamp(source, "last_message_time") },
  { field: "site_id", validator: "optionalText", validate: source => optionalText(source, "site_id", 16) },
  { field: "title", validator: "optionalText", validate: source => optionalText(source, "title", 512) },
  { field: "to_position", validator: "optionalTimestamp", validate: source => optionalTimestamp(source, "to_position") },
  { field: "tags", validator: "optionalTags", validate: source => optionalTags(source) },
];

function logSessionProjectFieldDiagnostics(value: unknown) {
  const source = isRecord(value) ? value : null;
  const fields = sessionDiagnosticFieldNames.map(field => {
    const fieldValue = source?.[field];
    return {
      field,
      valueType: Array.isArray(fieldValue) ? "array" : typeof fieldValue,
      isNull: fieldValue === null,
      isUndefined: fieldValue === undefined,
    };
  });
  const failedValidators = source
    ? sessionDiagnosticValidators.flatMap(({ field, validator, validate }) => {
      try {
        validate(source);
        return [];
      } catch {
        return [{ field, validator }];
      }
    })
    : [{ field: "item", validator: "projectSession" }];
  logger.warn({ fields, failedValidators }, "Lazada IM session item validation diagnostic");
}

function projectSession(value: unknown, detail = false): ImSession {
  if (!isRecord(value)) throw new LazadaError("invalid_response");
  return {
    session_id: requiredText(value.session_id),
    ...(detail
      ? optionalText(value, "content") !== undefined ? { content: optionalText(value, "content") } : {}
      : optionalText(value, "summary") !== undefined ? { summary: optionalText(value, "summary") } : {}),
    ...(optionalText(value, "title", 512) !== undefined ? { title: optionalText(value, "title", 512) } : {}),
    ...(optionalText(value, "last_message_id") !== undefined
      ? { last_message_id: optionalText(value, "last_message_id") } : {}),
    ...(optionalTimestamp(value, "last_message_time") !== undefined
      ? { last_message_time: optionalTimestamp(value, "last_message_time") } : {}),
    ...(optionalNumber(value, "unread_count") !== undefined ? { unread_count: optionalNumber(value, "unread_count") } : {}),
    ...(optionalTimestamp(value, "self_position") !== undefined ? { self_position: optionalTimestamp(value, "self_position") } : {}),
    ...(optionalTimestamp(value, "to_position") !== undefined ? { to_position: optionalTimestamp(value, "to_position") } : {}),
    ...(optionalTags(value) !== undefined ? { tags: optionalTags(value) } : {}),
    ...(optionalText(value, "site_id", 16) !== undefined ? { site_id: optionalText(value, "site_id", 16) } : {}),
  };
}

function projectSessionListEntry(value: unknown, index: number): ImSession {
  try {
    return projectSession(value);
  } catch (error) {
    if (index === 0 && error instanceof LazadaError && error.reason === "invalid_response")
      logSessionProjectFieldDiagnostics(value);
    throw error;
  }
}

function projectMessage(value: unknown): ImMessage {
  if (!isRecord(value)) throw new LazadaError("invalid_response");
  return {
    message_id: requiredText(value.message_id),
    ...(optionalText(value, "content", 65_536) !== undefined ? { content: optionalText(value, "content", 65_536) } : {}),
    ...(optionalNumber(value, "from_account_type") !== undefined
      ? { from_account_type: optionalNumber(value, "from_account_type") } : {}),
    ...(optionalTimestamp(value, "send_time") !== undefined ? { send_time: optionalTimestamp(value, "send_time") } : {}),
    ...(optionalNumber(value, "template_id") !== undefined ? { template_id: optionalNumber(value, "template_id") } : {}),
    ...(optionalNumber(value, "to_account_type") !== undefined
      ? { to_account_type: optionalNumber(value, "to_account_type") } : {}),
    ...(optionalNumber(value, "type") !== undefined ? { type: optionalNumber(value, "type") } : {}),
    ...(optionalText(value, "process_msg", 2048) !== undefined
      ? { process_msg: optionalText(value, "process_msg", 2048) } : {}),
    ...(optionalNumber(value, "status") !== undefined ? { status: optionalNumber(value, "status") } : {}),
    ...(optionalBoolean(value, "auto_reply") !== undefined ? { auto_reply: optionalBoolean(value, "auto_reply") } : {}),
    ...(optionalText(value, "site_id", 16) !== undefined ? { site_id: optionalText(value, "site_id", 16) } : {}),
  };
}

function requiredPageData(value: unknown, key: "session_list" | "message_list") {
  if (!isRecord(value) || typeof value.has_more !== "boolean" || !Array.isArray(value[key]))
    throw new LazadaError("invalid_response");
  const nextStartTime = optionalTimestamp(value, "next_start_time");
  const cursor = optionalText(value, key === "session_list" ? "last_session_id" : "last_message_id");
  if (value.has_more && (!nextStartTime || !cursor)) throw new LazadaError("invalid_response");
  return { has_more: value.has_more, next_start_time: nextStartTime ?? null, cursor: cursor ?? null, entries: value[key] };
}

function providerFailure(code: unknown, httpStatus?: number): LazadaError {
  const providerCode = typeof code === "string" || typeof code === "number" ? String(code) : "";
  if (httpStatus === 401 || /IllegalAccessToken|InvalidAccessToken|InvalidCode|TokenExpired/i.test(providerCode))
    return new LazadaError("authorization_failed");
  if (httpStatus === 403 || /Permission|Forbidden|AccessDenied|Scope/i.test(providerCode))
    return new LazadaError("permission_denied");
  return new LazadaError("api_unavailable");
}

function isSuccessCode(value: unknown): boolean {
  return value === 0 || value === "0";
}

function responseErrorCode(body: JsonRecord): unknown {
  if (body.err_code !== undefined && !isSuccessCode(body.err_code)) return body.err_code;
  return body.code ?? body.err_code;
}

export function createImClient(config: LazadaConfig, transport: typeof fetch = fetch) {
  async function call(path: typeof sessionPath | typeof detailPath | typeof messagesPath,
    accessToken: string, business: Record<string, string>): Promise<ImProviderResponse> {
    if (!accessToken || accessToken.length > 8192) throw new LazadaError("authorization_failed");
    const params = { ...business, app_key: config.appKey, access_token: accessToken,
      sign_method: "sha256", timestamp: String(Date.now()) };
    const signatureValue = signature(path, params, config.appSecret);
    const signedParams = new URLSearchParams({ ...params, sign: signatureValue });
    const sensitiveValues = [
      config.appSecret, params.app_key, params.access_token, signatureValue,
      business.session_id, business.last_session_id, business.last_message_id,
    ].filter((value): value is string => typeof value === "string" && value.length >= 4);
    const url = new URL(`${endpoints[config.country]}${path}`);
    url.search = signedParams.toString();
    let response: Response;
    let text: string;
    let httpStatus: number | null = null;
    try {
      response = await transport(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000) });
      httpStatus = response.status;
      text = await response.text();
    } catch {
      logProviderFailure(path, httpStatus, null, sensitiveValues);
      throw new LazadaError("api_unavailable");
    }
    if (text.length > MAX_RESPONSE_LENGTH) {
      logProviderFailure(path, httpStatus, null, sensitiveValues);
      throw new LazadaError("api_unavailable");
    }
    let body: unknown;
    try { body = JSON.parse(text); } catch {
      logProviderFailure(path, httpStatus, null, sensitiveValues);
      throw new LazadaError("invalid_response");
    }
    if (!isRecord(body)) {
      logProviderFailure(path, httpStatus, null, sensitiveValues);
      throw new LazadaError("invalid_response");
    }
    if (!response.ok) {
      logProviderFailure(path, httpStatus, body, sensitiveValues);
      throw providerFailure(responseErrorCode(body), response.status);
    }
    if (body.success !== true) {
      logProviderFailure(path, httpStatus, body, sensitiveValues);
      throw providerFailure(responseErrorCode(body));
    }
    if (!isSuccessCode(body.err_code)) {
      logProviderFailure(path, httpStatus, body, sensitiveValues);
      throw providerFailure(body.err_code);
    }
    if (body.code !== undefined && !isSuccessCode(body.code)) {
      logProviderFailure(path, httpStatus, body, sensitiveValues);
      throw providerFailure(body.code);
    }
    if (!isRecord(body.data)) {
      logProviderFailure(path, httpStatus, body, sensitiveValues);
      if (path === sessionPath) logSessionListDataStructure(body.data);
      throw new LazadaError("invalid_response");
    }
    return { path, httpStatus, body, data: body.data, sensitiveValues };
  }

  return {
    async getSessionList(accessToken: string, input: ImPageInput) {
      const response = await call(sessionPath, accessToken, {
        start_time: input.startTime,
        page_size: String(input.pageSize),
        ...(input.cursor ? { last_session_id: input.cursor } : {}),
      });
      return parseProviderData(response, data => {
        const page = requiredPageData(data, "session_list");
        return {
          has_more: page.has_more,
          next_start_time: page.next_start_time,
          last_session_id: page.cursor,
          session_list: page.entries.map((entry, index) => projectSessionListEntry(entry, index)),
        };
      });
    },
    async getSessionDetail(accessToken: string, sessionId: string) {
      const response = await call(detailPath, accessToken, { session_id: sessionId });
      return parseProviderData(response, data => ({ session: projectSession(data, true) }));
    },
    async getMessages(accessToken: string, sessionId: string, input: ImPageInput) {
      const response = await call(messagesPath, accessToken, {
        session_id: sessionId,
        start_time: input.startTime,
        page_size: String(input.pageSize),
        ...(input.cursor ? { last_message_id: input.cursor } : {}),
      });
      return parseProviderData(response, data => {
        const page = requiredPageData(data, "message_list");
        return {
          has_more: page.has_more,
          next_start_time: page.next_start_time,
          last_message_id: page.cursor,
          message_list: page.entries.map(projectMessage),
        };
      });
    },
  };
}

export const imPageSizeLimit = MAX_PAGE_SIZE;
