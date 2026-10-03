---
name: Workspace dependency resolution
description: Lockfile audit can differ from installed workspace dependencies after a scoped update
---

Check installed workspace resolutions in addition to auditing the committed lockfile after dependency upgrades.

**Why:** A root-scoped package update can refresh the shared lockfile while another workspace still resolves an older transitive dependency through its existing symlinks. The lockfile audit alone can report a fix that the running tool has not received.

**How to apply:** Inspect the actual workspace resolution with pnpm why or Node resolution. Synchronize all workspaces using the frozen lockfile before verification; offline synchronization is sufficient when the managed install has already populated the package store.