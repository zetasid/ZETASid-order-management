import { Router } from "express";
import { LazadaError } from "../modules/lazada/client";
import { getImMessages, getImSessionDetail, getImSessionList } from "../modules/lazada/im-chat";
import { imPageSizeLimit } from "../modules/lazada/im-client";

const router = Router();
const SESSION_ID = /^[A-Za-z0-9._:-]{1,256}$/;

router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

function queryString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

function validTimestamp(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{1,16}$/.test(value)
    && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function pageInput(query: Record<string, unknown>, cursorName: "last_session_id" | "last_message_id") {
  if (Object.hasOwn(query, "start_time")) return null;
  const rawPageSize = queryString(query.page_size);
  const nextStartTime = queryString(query.next_start_time);
  const rawCursor = queryString(query[cursorName]);
  if (nextStartTime === null || rawCursor === null || !rawPageSize || !/^\d{1,2}$/.test(rawPageSize))
    return null;
  const pageSize = Number(rawPageSize);
  if (pageSize < 1 || pageSize > imPageSizeLimit) return null;
  const cursor = rawCursor?.trim() || undefined;
  if (nextStartTime === undefined) {
    if (cursor !== undefined) return null;
    return { startTime: String(Date.now()), pageSize };
  }
  if (!validTimestamp(nextStartTime) || !cursor || !SESSION_ID.test(cursor)) return null;
  return { startTime: nextStartTime, pageSize, cursor };
}

function validSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID.test(value);
}

function sendFailure(res: import("express").Response, error: unknown) {
  const reason = error instanceof LazadaError ? error.reason : "api_unavailable";
  const messages = {
    authorization_failed: "Koneksi Lazada belum terverifikasi atau token tidak valid.",
    permission_denied: "Lazada belum memberikan izin untuk membaca In-house IM Chat.",
    invalid_response: "Response IM Lazada tidak sesuai format yang diharapkan.",
    api_unavailable: "Layanan IM Lazada tidak dapat dihubungi.",
    wrong_country: "Negara koneksi Lazada tidak sesuai konfigurasi.",
    sync_busy: "Permintaan IM Lazada tidak dapat diproses saat ini.",
  } as const;
  const status = reason === "authorization_failed" ? 409 : reason === "permission_denied" ? 403 : 502;
  res.status(status).json({ error: messages[reason] });
}

router.get("/lazada/im/sessions", async (req, res) => {
  const input = pageInput(req.query as Record<string, unknown>, "last_session_id");
  if (!input) { res.status(400).json({ error: "Parameter halaman IM Lazada tidak valid." }); return; }
  try { res.json(await getImSessionList(res.locals.auth.user.id, input)); }
  catch (error) { sendFailure(res, error); }
});

router.get("/lazada/im/sessions/:sessionId/messages", async (req, res) => {
  const sessionId: unknown = req.params.sessionId;
  const input = pageInput(req.query as Record<string, unknown>, "last_message_id");
  if (!validSessionId(sessionId) || !input) {
    res.status(400).json({ error: "Parameter pesan IM Lazada tidak valid." }); return;
  }
  try { res.json(await getImMessages(res.locals.auth.user.id, sessionId, input)); }
  catch (error) { sendFailure(res, error); }
});

router.get("/lazada/im/sessions/:sessionId", async (req, res) => {
  const sessionId: unknown = req.params.sessionId;
  if (!validSessionId(sessionId)) { res.status(400).json({ error: "ID sesi IM Lazada tidak valid." }); return; }
  try { res.json(await getImSessionDetail(res.locals.auth.user.id, sessionId)); }
  catch (error) { sendFailure(res, error); }
});

export default router;
