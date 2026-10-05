---
name: Authentication choice
description: The user's choice of local authentication instead of managed Clerk
---

The user selected “Login lokal PostgreSQL (recommended)” when asked which authentication approach to use for ZETAS.id.

**Why:** The user explicitly chose that option.

**How to apply:** Preserve this local authentication approach unless the user requests a different provider; do not replace it with Clerk simply because Clerk is the default for new authentication requests.

Login persistence: "setiap login ... jangan Logout otomatis ... durasi minimal
1 bulan kecuali di logout".

**Why:** The user explicitly requested month-long login persistence instead of
short automatic logout.

**How to apply:** Keep sessions for at least 30 days and renew them with activity,
without restoring a short idle timeout or an eight-hour absolute cap. Preserve
manual logout and security revocation on password reset or account deactivation.