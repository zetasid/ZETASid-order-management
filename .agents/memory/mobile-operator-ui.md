---
name: ZETAS operator UI
description: Mobile-first UI constraints and safe scope boundaries for the ZETAS.id order-management app
---

ZETAS.id is used to process orders through Android. Prioritize quick status scanning, comfortable tap targets, one-handed navigation, readable data, and responsive layouts from mobile through desktop.

**Why:** The user identified Android order processing as the primary operator context and scoped UI finishing to visual/interface work.

**How to apply:** Keep UI work presentational. Do not change APIs, backend/database/auth, payment or order-processing logic, Lazada/supplier integrations, webhooks, CI, Docker, or dependencies. Use only available data and avoid unsupported settings or fake controls.
