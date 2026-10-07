---
name: Lazada IM request volume
description: The shared Lazada IM API documentation warns against polling session and message list endpoints.
---

Do not build periodic polling around `GET /im/session/list` or `GET /im/message/list`. Lazada says these endpoints should be called at very low volume because an IM push channel exists, and detected polling may cause the API permissions to be reclaimed.

**Why:** The official Lazada IM API documentation explicitly warns that polling these endpoints can lead to IM permission revocation.

**How to apply:** Keep Phase 1 reads user-triggered and single-page. Any real-time sync must be designed around a separately authorized and verified push/webhook flow.
