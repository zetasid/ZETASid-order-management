---
name: Public webhook verification
description: Internal Replit requests can bypass the public private-app gate and expose a proxy certificate.
---

Do not treat a successful request from the workspace or execution sandbox as
proof that an unauthenticated internet server can reach a webhook.

**Why:** Both environments can observe a trusted internal Replit proxy
certificate and reach the app handler while an independent internet probe
receives a redirect to Replit's private-app login. Local TLS verification can
also validate that internal proxy rather than the public certificate.

**How to apply:** Check accessibility through an independent external HTTP
probe, including redirects/login pages, and inspect the public certificate
through an external TLS checker. Distinguish app signature rejection from
platform authentication. A valid HTTPS certificate does not establish OV/EV
eligibility or suitability for Lazada LPM.