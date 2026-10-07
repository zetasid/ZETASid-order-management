---
name: Lazada IM API contract gaps
description: The shared Lazada IM reference gives endpoint paths and business parameters but omits several transport-level details.
---

The shared Lazada IM reference documents the read endpoint paths, business parameters, payload fields, and pagination. It does not specify HTTP methods, common signing parameters/formula, regional host mapping, or the top-level response envelope for these endpoints. Do not treat Lazada order API conventions or synthetic fixtures as proof that IM uses the same transport contract.

**Why:** the public Open Platform API reference was login-gated during verification, while the shared IM guide did not state these details.

**How to apply:** mark undocumented IM transport details as unconfirmed. Before a real request, obtain an authoritative IM-specific reference or perform an explicitly authorized read-only test against the testing environment.
