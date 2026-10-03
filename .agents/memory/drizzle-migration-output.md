---
name: Drizzle migration output
description: A Drizzle Kit path handling quirk when generating a subsequent migration
---

Keep Drizzle Kit's migration output path relative to the database package, and run it through the package's pnpm scripts.

**Why:** An absolute output directory worked for the first migration but failed on the next generation: Drizzle Kit prefixed the absolute snapshot path with `./`, producing a nonexistent path.

**How to apply:** Use a package-relative output directory for generation and migration; do not change it to an absolute path when adjusting configuration or Docker tooling.