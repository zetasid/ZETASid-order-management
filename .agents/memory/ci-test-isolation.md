---
name: CI test isolation
description: Why integration tests need serial execution and disposable auth state
---

Run integration test files serially against a disposable PostgreSQL database with a fresh test session secret.

**Why:** A bulk order-search fixture can push another test's new order outside the 100-row list limit when files run concurrently. Persisted IP login buckets also affect repeated runs using the same session secret.

**How to apply:** Keep the serial test policy unless each test file receives a genuinely isolated database/server. Do not reset shared production or development rate-limit buckets to make tests pass.