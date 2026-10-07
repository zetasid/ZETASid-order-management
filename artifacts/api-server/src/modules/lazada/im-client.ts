import { LazadaError, signature } from "./client";
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

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
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

export function createImClient(config: LazadaConfig, transport: typeof fetch = fetch) {
  async function call(path: typeof sessionPath | typeof detailPath | typeof messagesPath,
    accessToken: string, business: Record<string, string>): Promise<JsonRecord> {
    if (!accessToken || accessToken.length > 8192) throw new LazadaError("authorization_failed");
    const params = { ...business, app_key: config.appKey, access_token: accessToken,
      sign_method: "sha256", timestamp: String(Date.now()) };
    const signedParams = new URLSearchParams({ ...params, sign: signature(path, params, config.appSecret) });
    const url = new URL(`${endpoints[config.country]}${path}`);
    url.search = signedParams.toString();
    let response: Response;
    let text: string;
    try {
      response = await transport(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000) });
      text = await response.text();
    } catch {
      throw new LazadaError("api_unavailable");
    }
    if (text.length > MAX_RESPONSE_LENGTH) throw new LazadaError("api_unavailable");
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new LazadaError("invalid_response"); }
    if (!isRecord(body)) throw new LazadaError("invalid_response");
    if (!response.ok) throw providerFailure(body.code, response.status);
    if (String(body.code) !== "0") throw providerFailure(body.code);
    if (!isRecord(body.data)) throw new LazadaError("invalid_response");
    return body.data;
  }

  return {
    async getSessionList(accessToken: string, input: ImPageInput) {
      const data = await call(sessionPath, accessToken, {
        start_time: input.startTime,
        page_size: String(input.pageSize),
        ...(input.cursor ? { last_session_id: input.cursor } : {}),
      });
      const page = requiredPageData(data, "session_list");
      return {
        has_more: page.has_more,
        next_start_time: page.next_start_time,
        last_session_id: page.cursor,
        session_list: page.entries.map(entry => projectSession(entry)),
      };
    },
    async getSessionDetail(accessToken: string, sessionId: string) {
      const data = await call(detailPath, accessToken, { session_id: sessionId });
      return { session: projectSession(data, true) };
    },
    async getMessages(accessToken: string, sessionId: string, input: ImPageInput) {
      const data = await call(messagesPath, accessToken, {
        session_id: sessionId,
        start_time: input.startTime,
        page_size: String(input.pageSize),
        ...(input.cursor ? { last_message_id: input.cursor } : {}),
      });
      const page = requiredPageData(data, "message_list");
      return {
        has_more: page.has_more,
        next_start_time: page.next_start_time,
        last_message_id: page.cursor,
        message_list: page.entries.map(projectMessage),
      };
    },
  };
}

export const imPageSizeLimit = MAX_PAGE_SIZE;
