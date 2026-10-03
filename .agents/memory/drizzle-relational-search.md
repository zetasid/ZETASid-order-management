---
name: Drizzle relational search
description: Avoid parent-table alias mismatches in item searches inside relational queries
---

Prefer an uncorrelated `IN` subquery when filtering a Drizzle relational parent query by matching children, unless a correlated subquery's outer reference is explicitly verified against the generated alias.

**Why:** A standard select embedded in a relational query retained the original parent table name in its outer reference, while the relational query renamed the parent table. PostgreSQL rejected the search even though unfiltered list/detail reads worked.

**How to apply:** When adding item-based search conditions to relational queries, verify a filtered request with actual database records; type checking and an unfiltered request cannot detect this alias mismatch.