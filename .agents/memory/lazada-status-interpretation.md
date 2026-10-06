---
name: Lazada status interpretation
description: Why official flow diagrams and non-mutating read projections matter when correcting status groups
---

Verify ambiguous Lazada item-status meanings against the official Order Status Flow diagram, not generic connector/package labels.

**Why:** Text searches omitted the diagram's transitions and returned third-party package terminology with a different meaning. Official documentation puts key lifecycle information in images that text extraction alone does not capture.

**How to apply:** Inspect the linked diagrams when documentary text is insufficient; use the actual GetOrderItems status, preserving its original spelling. The source references are in docs/lazada-status-mapping.md.

Read actual Lazada article content before treating an empty text fetch as a documentation gap.

**Why:** Official Lazada documentation pages can return only their navigation shell to text extraction even though the article is publicly readable through the documentation reader's data service.

**How to apply:** If a page fetch contains only navigation, inspect the public reader's document-data request and read its article content. The public reader uses `/handler/share/doc/getDocDetail.json` with `docId`, `oeid=LZD_DOC` and `lang=en_US`; inspect `enContent`, not just the shell. No credentials are needed. Only conclude that a contract is undocumented after reading the actual article.

Correct display/filter grouping through the read model when only display semantics should change. A requested sync may persist a fresh Lazada snapshot, but must never locally rewrite or backfill status values.

**Why:** The user previously prohibited status-only data backfills, then explicitly required manual order reading to refresh real status changes for older orders. Reinterpreting stored values is still different from persisting a newly fetched provider snapshot.

**How to apply:** Keep raw Lazada snapshots intact and derive UI/filter groups from `GetOrderItems.status`. For manual and automatic refreshes, query Lazada by `update_after`/`update_before` with overlap where applicable, then persist only the fresh response. Never invoke DeliverDigital as part of a status refresh.

Keep Lazada workflow status separate from payment evidence. GetOrder/GetOrders statuses and payment_method do not prove payment; confirmation requires a valid GetOrderItems payment_time for every item and no unpaid/unknown stage_pay_status.

**Why:** Workflow states such as to_pack, to_ship, shipped, delivered, or confirmed describe order progress, not a settled payment. The official GetOrderItems contract exposes payment_time as the actual payment-time field; partial, missing, invalid, or ambiguous evidence must fail closed.

**How to apply:** Preserve payment_time and stage_pay_status from GetOrderItems. A valid timestamp on every item is required; stage_pay_status `unpaid` or `unpaid final payment`, an unknown stage, or missing/invalid time blocks delivery and revenue. Re-read the provider snapshot before delivery and keep the existing pending-order, pending-item, explicit-digital, cancellation, completion, idempotency, and lock checks.

Use raw Lazada status only for workflow labels. Progress such as packed/to_pack remains “Dikemas” and shipped/to_ship remains “Dikirim” even if payment evidence is unknown; the separate payment badge stays unknown and digital delivery remains disabled.

**Why:** Changing a workflow label must not grant payment eligibility or hide an unknown payment state.

**How to apply:** Keep `paymentStatus` distinct from `status` and raw `sourceStatus`. Use the payment evidence gate on both frontend and backend; do not infer payment from display text.

Count revenue only when payment is confirmed and the effective order workflow is processing or completed; exclude pending, cancelled, and unmapped states.

**Why:** The user explicitly forbids counting unpaid, pending, cancelled, or unknown orders as revenue.

**How to apply:** Keep payment confirmation and workflow state as separate requirements in the summary projection; do not infer paid status from order workflow or payment method alone.