---
name: Orval mutation schemas
description: Generation quirks encountered when introducing the first POST API contract
---

Use reusable named schemas for mutation request bodies, and include DOM.Iterable in the generated browser client's TypeScript libraries.

**Why:** Inline POST bodies caused a validator and generated body type to have the same export name, breaking the shared Zod barrel. Mutation header-merging helpers also use Headers.entries, which is not covered by DOM alone.

**How to apply:** Keep mutation request bodies as schema references when adding new POST/PUT/PATCH contracts, and regenerate/check shared libraries before using their hooks.