---
name: GitHub integration and Git authentication
description: A working GitHub API integration does not prove native Git authentication is usable
---

Treat GitHub connector authorization and native Git authentication as separate checks.

**Why:** The GitHub connector successfully accessed the repository with push permission while native Git continued rejecting its credentials. Attaching the connector did not repair the existing Git authentication path.

**How to apply:** Verify native Git access before claiming a push is possible. If the API connector works but Git fails, repair the Replit Git/Connected Services authentication rather than repeatedly reconnecting a healthy API integration.