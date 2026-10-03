---
name: Preview cookie rewriting
description: Cookie attributes can differ between the direct API and HTTPS development preview
---

In this workspace, the HTTPS development preview rewrites a backend SameSite=Strict cookie to SameSite=None and Secure. Direct API and local preview responses retain Strict.

**Why:** Browser testing reported an attribute mismatch despite the correct server setting; credential-free attribute comparisons across direct/local/HTTPS endpoints confirmed the difference at the preview proxy. Official documentation did not explain it.

**How to apply:** Compare cookie attributes without logging values when diagnosing preview authentication. Do not relax source cookie policy to match preview behavior. Keep Origin and CSRF validation enforced, and verify final HTTPS cookie attributes independently on the actual self-hosted/published deployment.