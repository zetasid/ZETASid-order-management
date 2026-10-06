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

Correct display/filter grouping through the read model when existing order data must remain unchanged.

**Why:** The user explicitly required that correcting the status mapping must not change already-stored orders or run DeliverDigital. A backfill or re-sync would violate that requirement even if the resulting groups were correct.

**How to apply:** Keep raw snapshots and existing rows intact, derive groups consistently for list/filter/detail/summary, and verify row fingerprints. Do not use a sync action as a status-correction mechanism.

Keep Lazada order-header payment eligibility separate from item-level digital processing. A paid/confirmed header is required for delivery; unpaid, pending, cancelled, missing, or unknown headers fail closed. Completed and cancelled workflow states cannot be processed again.

**Why:** The user explicitly requires unpaid or unclear payment states to block delivery and revenue, and completed/cancelled orders to remain non-processable.

**How to apply:** Re-read the order header and `GetOrderItems.status` from Lazada before delivery. Require a confirmed header and eligible pending item workflow; fail closed on unknown states and never retry completed/cancelled orders.

Use “Belum Dibayar” only when the payment header is unpaid, pending, or unknown. When the header is confirmed but fulfillment is still workflow-pending, show “Menunggu Proses” in the detail status banner so the eligible send action is never paired with an unpaid label.

**Why:** The user requires that no “Belum Dibayar” order show a send action, while the existing valid fulfillment flow begins with confirmed payment and pending item status.

**How to apply:** Keep `paymentStatus` distinct from the item-derived workflow status. Do not relabel Dashboard, order filters, or unrelated UI as part of a security-only change.

Count revenue only when payment is confirmed and the effective order workflow is processing or completed; exclude pending, cancelled, and unmapped states.

**Why:** The user explicitly forbids counting unpaid, pending, cancelled, or unknown orders as revenue.

**How to apply:** Keep payment confirmation and workflow state as separate requirements in the summary projection; do not infer paid status from item state alone.