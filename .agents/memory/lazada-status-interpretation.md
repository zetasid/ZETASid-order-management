---
name: Lazada status interpretation
description: Why official flow diagrams and non-mutating read projections matter when correcting status groups
---

Verify ambiguous Lazada item-status meanings against the official Order Status Flow diagram, not generic connector/package labels.

**Why:** Text searches omitted the diagram's transitions and returned third-party package terminology with a different meaning. Official documentation puts key lifecycle information in images that text extraction alone does not capture.

**How to apply:** Inspect the linked diagrams when documentary text is insufficient; use the actual GetOrderItems status, preserving its original spelling. The source references are in docs/lazada-status-mapping.md.

Correct display/filter grouping through the read model when existing order data must remain unchanged.

**Why:** The user explicitly required that correcting the status mapping must not change already-stored orders or run DeliverDigital. A backfill or re-sync would violate that requirement even if the resulting groups were correct.

**How to apply:** Keep raw snapshots and existing rows intact, derive groups consistently for list/filter/detail/summary, and verify row fingerprints. Do not use a sync action as a status-correction mechanism.