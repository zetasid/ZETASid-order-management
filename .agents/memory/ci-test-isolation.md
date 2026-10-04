---
name: CI test isolation
description: Why integration tests need serial execution and disposable auth state
---

Run integration test files serially against a disposable PostgreSQL database with a fresh test session secret.

**Why:** A bulk order-search fixture can push another test's new order outside the 100-row list limit when files run concurrently. Persisted IP login buckets also affect repeated runs using the same session secret.

**How to apply:** Keep the serial test policy unless each test file receives a genuinely isolated database/server. For repeated authentication checks during development, use a separate temporary API process with a fresh session secret, not the user's running preview. Unique test accounts do not isolate the IP limiter. Do not reset shared production or development rate-limit buckets to make tests pass.

Node HTTP integration tests against the preview can retain handles after assertions and cleanup finish.

**Why:** A completed test file can prevent later files from starting when its process cannot exit; that timeout is different from an assertion failure.

**How to apply:** Ensure the test runner has an explicit exit policy after all tests and cleanup hooks complete. Do not bypass unfinished tests or cleanup to hide failures.