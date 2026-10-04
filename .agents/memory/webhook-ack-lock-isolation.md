---
name: Webhook ACK lock isolation
description: Keep durable Lazada receipts independent of rows locked by slow import workers.
---

The signed webhook receipt must not initialize or update monitoring rows that
an import/reconciliation transaction holds locked while waiting for provider
APIs. Compute last receipt time from the durable event queue instead.

**Why:** Lazada expects HTTP 200 within 500 ms. A seemingly small monitoring
write can block behind many slow API calls and violate that deadline even
though no API is fetched directly inside the webhook request.

**How to apply:** When changing receipt metrics, transaction boundaries, or
worker state initialization, check row-lock dependencies as well as direct
network calls. Preserve a concurrency test that receives a fresh signed event
while a slow reconciliation is already running.