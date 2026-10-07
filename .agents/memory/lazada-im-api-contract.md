---
name: Lazada IM API contract gaps
description: The shared Lazada IM reference defines read pagination and the IM response envelope but omits some transport-level details.
---

The shared Lazada IM reference documents read endpoint paths, business parameters, payload fields, pagination, and the IM response envelope (`success`, `err_code`, `err_message`, `data`). For session/message list pagination, the first page uses the current timestamp; later pages pass the returned `next_start_time` with the corresponding last-session or last-message ID. Do not let the browser choose the first-page timestamp.

The reference still does not specify HTTP methods, common signing parameters/formula, or regional host mapping. Do not treat Lazada order API conventions or synthetic fixtures as proof that IM uses the same transport contract.

**Why:** the IM-specific audit clarified the response and pagination contract, while the Open Platform endpoint reference remains login-gated for transport details.

**How to apply:** use the documented IM envelope and server-owned first-page timestamp. Keep HTTP method and signing unconfirmed until an IM-specific source or an explicitly authorized testing request verifies them.
