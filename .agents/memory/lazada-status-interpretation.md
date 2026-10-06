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

Keep Lazada order-header payment eligibility separate from item-level digital processing. A paid/confirmed header does not prove digital delivery; an unpaid, pending, cancelled, missing, or unknown header must not qualify for revenue or delivery.

**Why:** The user identified unpaid orders incorrectly appearing processable or as revenue, and explicitly required payment confirmation not to be confused with digital fulfillment.

**How to apply:** Use the order header's raw status for payment eligibility and revenue, use `GetOrderItems.status` for the processing stage, re-read both from Lazada immediately before delivery, and fail closed on unknown or conflicting item states.