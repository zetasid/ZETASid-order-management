---
name: Public webhook verification
description: Public webhook reachability and the user's Nginx/Cloudflare TLS termination on VPS.
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

For Lazada Push Verify, never infer a verification payload contract from a static
trade example, its IDs or timestamps, an invented flag, or a valid HMAC alone.

**Why:** The user explicitly rejected static-sample recognition and instructed:
"Jika dokumentasi tidak cukup untuk mengetahui format Verify aktual, jangan
menebak dan jangan membuat bypass." The user states that actual Verify reaches
their VPS but receives HTTP 400; callback reachability alone is not a payload
contract.

**How to apply:** Require documented or independently established Verify format
before adding a separate ACK path. Preserve raw-body HMAC and normal order
parser/queue; report missing evidence rather than claiming live Verify works.

The user confirmed that the VPS Lazada configuration targets Indonesia
(`LAZADA_COUNTRY=id`).

**Why:** The user supplied the VPS runtime value; a repository default alone
cannot establish whether a deployed environment overrides it.

**How to apply:** Treat Indonesia as the configured target unless the user
changes it. Establish the incoming Verify site independently; never infer its
actual value from the application's configured country.

Do not assume the App Console's signed push/Verify site matches the seller's
API country.

**Why:** The user supplied production evidence showing `site=lazada_sg` and
`message_type=0` for their app while its VPS API country is `id`. Changing the
API country to match that notification would route Indonesian order requests
to the wrong marketplace.

**How to apply:** Keep app webhook identity separate from seller API region.
Accept only the explicitly authorized app site, not every supported site.
When changing webhook configuration, verify that API routing and existing
connection/token identity remain unchanged.

The user reports that ZETAS runs behind Nginx/Cloudflare on their VPS. External
HTTPS and the internal reverse-proxy connection are separate transport layers.

**Why:** The user identified proxy-protocol recognition as a cause of HTTP 400
at the HTTPS guard. This finding is not permission to relax signature, payload,
timestamp or queue validation, and does not establish the live Verify format.

**How to apply:** Check the trusted proxy boundary before investigating a
payload rejection. Forwarded HTTPS is meaningful only from a trusted proxy
that overwrites client-supplied forwarding headers.

The Lazada Open Platform IM webhook reference may render as a JavaScript shell
without exposing the article text to a noninteractive fetch. In this workspace,
the official page returned a shell only, while the documentation fetch/search
tools failed; the user-provided IM PDF was a summary and omitted signature,
header, and ACK details.

**Why:** Webhook authentication and seller-account mapping cannot be inferred
from a summary or from the unrelated Lazada Order Push contract.

**How to apply:** Before implementing IM Push, obtain the official article text
or export that specifies signature construction, headers, account identity,
and ACK/retry behavior. If those details remain unavailable, stop rather than
reverse-engineer or assume the contract.