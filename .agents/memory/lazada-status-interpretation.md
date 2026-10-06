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

Keep Lazada order-header payment eligibility separate from item-level digital processing. A paid/confirmed header is required for delivery; unpaid, pending, cancelled, missing, or unknown headers fail closed. Completed and cancelled workflow states cannot be processed again.

**Why:** The user explicitly requires unpaid or unclear payment states to block delivery and revenue, and completed/cancelled orders to remain non-processable.

**How to apply:** Re-read the order header and `GetOrderItems.status` from Lazada before delivery. Require a confirmed header and eligible pending item workflow; fail closed on unknown states and never retry completed/cancelled orders.

Use “Belum Dibayar” only when the payment header is unpaid, pending, or unknown. When the header is confirmed but fulfillment is still workflow-pending, show “Menunggu Proses” in the detail status banner so the eligible send action is never paired with an unpaid label.

**Why:** The user requires that no “Belum Dibayar” order show a send action, while the existing valid fulfillment flow begins with confirmed payment and pending item status.

**How to apply:** Keep `paymentStatus` distinct from the item-derived workflow status. Do not relabel Dashboard, order filters, or unrelated UI as part of a security-only change.

Count revenue only when payment is confirmed and the effective order workflow is processing or completed; exclude pending, cancelled, and unmapped states.

**Why:** The user explicitly forbids counting unpaid, pending, cancelled, or unknown orders as revenue.

**How to apply:** Keep payment confirmation and workflow state as separate requirements in the summary projection; do not infer paid status from item state alone.