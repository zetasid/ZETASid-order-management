---
name: GitHub integration and Git authentication
description: A working GitHub API integration does not prove native Git authentication is usable
---

Treat GitHub connector authorization and native Git authentication as separate checks.

**Why:** The GitHub connector successfully accessed the repository with push permission while native Git continued rejecting its credentials. Attaching the connector did not repair the existing Git authentication path.

**How to apply:** Verify native Git access before claiming a push is possible. If the API connector works but Git fails, repair the Replit Git/Connected Services authentication rather than repeatedly reconnecting a healthy API integration.

For an explicitly requested repository push, the authenticated GitHub Git Data API is an alternative to native Git; never extract the connector's token.

**Why:** The connector injects credentials server-side, so uploading Git objects does not require copying credentials into Git configuration or handling secret values.

**How to apply:** Preserve commit parents and canonical hashes when replaying local commits, verify uploaded blob/tree/commit hashes, and advance the branch only by a non-forced fast-forward after confirming its current head. Read the canonical root tree hash from the commit's tree field, not a tree response requested using a commit hash.