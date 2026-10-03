---
name: Negative security tests
description: Verify the tested action crossed earlier authentication boundaries before asserting denial
---

A negative security test must demonstrate that the action reached the guard under test; denial alone is insufficient.

**Why:** An OAuth session-revocation test appeared to pass even when an earlier browser-cookie binding failure prevented the provider exchange from starting. It therefore did not initially prove that revocation during exchange was handled.

**How to apply:** In OAuth, CSRF, expiry and revocation tests, establish valid prerequisites and observe the relevant checkpoint before inducing failure. Keep concurrent/replay tests explicit about how many provider exchanges actually occurred.