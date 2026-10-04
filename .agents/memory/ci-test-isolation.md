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

Regression tests must own their synthetic fixture seeding and cleanup, not depend on an existing business-data distribution or external ad hoc seeding.

**Why:** A read-only status regression passed locally with externally seeded synthetic rows but still failed in GitHub Actions on a fresh empty database. Copying customer rows into the test environment would unnecessarily expose customer data and would not fix the hidden setup dependency.

**How to apply:** Seed the required synthetic distribution inside the test and isolate it from unrelated rows. Keep exact mapping and integrity assertions, verify cleanup, and check both an empty database and one with unrelated synthetic background rows. Never copy real customer data or change production behavior to accommodate fixtures.

Keep a temporary PostgreSQL server's startup, tests and shutdown in one shell invocation, or run it as an explicitly managed background task.

**Why:** During isolated verification, a daemon started with `pg_ctl` was no longer alive in the next shell invocation, despite its earlier successful startup. This caused readiness failures and connection refusals unrelated to application code.

**How to apply:** Do not assume daemonizing a child makes it persist between shell calls. Keep the full lifecycle together and use an exit trap for shutdown, or use the background-shell facility and stop it explicitly after testing.

Select the client role explicitly when working with a newly initialized temporary PostgreSQL cluster.

**Why:** Ambient PostgreSQL client defaults can select a role that does not exist in the temporary cluster, even though server startup succeeded. This is a test-harness setup failure, not an application regression.

**How to apply:** Use the role created for the temporary cluster consistently in database creation and test connection configuration, rather than inheriting unrelated workspace client defaults.