# API keys, webhooks and accounting connectors (OCTA-INT-API-026)

## Where

- **Company › Integrations** (`/company/integrations`, company admins): **API keys**, **Webhooks**, **Accounting**.
- **Commercial › Pay Applications**: *Export for accounting* (XLSX by cost code); the application workspace shows an **Accounting** block with *Send to accounting* for accounting approvers and the posted bill's status.

## API keys

- `POST /integrations/api-clients { name, scopes, projectIds?, expiresAt?, userId? }` returns the key **once** (`octapm_…`); only its SHA-256 and prefix are stored. Call the API with `Authorization: Bearer octapm_…`.
- A key **acts as the person who owns it** (the creator by default): every read and write is evaluated with that person's role, permission templates and party access, then **narrowed by the key's scopes** — `<module>:read` (read + export), `<module>:write` (everything on the module, implies read), `*:read`, `*:write` — and, when set, to the listed projects (403 `API_KEY_PROJECT` elsewhere). Keys can never administer the company (403 `API_KEY_FORBIDDEN`).
- Revoke (`DELETE …/api-clients/{id}`) or expire a key and every call stops at once (401 `API_KEY_INVALID` / `API_KEY_EXPIRED`); a key whose owner is deactivated stops too. `lastUsedAt` is kept.

## Webhooks

- A subscription has an https URL, a signing secret (generated or supplied, shown once, rotatable), event patterns and an optional project. Patterns: `*`, a bus type (`record.changed`, `approval.decided`, `notification.created`, `job.progress`) or `<entity>.<action>` (`rfi.status_changed`, `change_order.*`).
- Every event published on the domain bus (`OutboundEvent` log) is matched against the organisation's active subscriptions; each match is a **delivery** and a `webhook.deliver` job.
- Delivery: `POST` JSON `{ id, type, event, occurredAt, orgId, projectId, entity: { type, id }, action, actorId, payload, webhook: { subscriptionId, deliveryId, attempt } }` with headers `X-OctaPM-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`, `X-OctaPM-Event`, `X-OctaPM-Delivery`, `X-OctaPM-Attempt`, 10 s timeout. Any non-2xx answer or network error is a failed attempt; the job queue retries with backoff **up to 5 attempts**, then the delivery is **dead**. Ten dead deliveries in a row **disable** the subscription and notify PMs; re-enabling resets the count. **Test** sends a `webhook.test` event now; **Redeliver** queues a fresh attempt series for a dead or failed delivery.
- Receivers verify: reject if `|now − t| > 300 s`, then compare `v1` with their own HMAC in constant time (`webhook.service.verifySignature` shows the reference implementation).

## Accounting (QuickBooks Online, Xero)

- Server prerequisites: `INTEGRATION_SECRET_KEY` (tokens are AES-256-GCM encrypted at rest), `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` (`QBO_ENVIRONMENT=sandbox|production`), `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET`, and the OAuth redirect `${API_BASE_URL}/api/v1/integrations/accounting/{provider}/callback` (or `ACCOUNTING_REDIRECT_URI`) registered with the provider. The page shows what is missing.
- **Connect** opens the provider's consent screen; the callback validates the state (organisation + nonce, 15 min), exchanges the code, stores the tokens and returns to the page. Tokens refresh themselves; **Disconnect** forgets them.
- **Cost code mapping** per provider: cost code → account (chart of accounts loaded from the provider), `*` as the default account, `retention` and `back_charges` for the withheld lines.
- **Posting**: an approved pay application becomes a vendor **bill** — vendor ensured by name (created when missing), one line per cost code (work + materials on site), retention and back-charges as negative lines, total = net this period, `DocNumber` / `InvoiceNumber` = the application ref. Posting happens **automatically on approval** when the connection's *auto-post* switch is on, or by hand from the application (**Accounting approver** grant = transition `sub_pay_app.accounting_sync`, PM and finance). One bill per application per provider; unmapped cost codes fail the sync with the list of codes to map (no retry); provider outages retry up to 5 times; failures notify finance.
- **Payment status**: the hourly `accounting.poll` job (and *Check payments now*) reads each posted bill; when it is paid, OctaPM **records the payment** on the application (method = provider, reference = bill number) so the application turns *paid* and cash flow updates.
- **Export for any ERP**: `GET /integrations/accounting/export?format=xlsx|csv&provider&from&to&projectId` and the project variant — one row per pay-application line (project, vendor, commitment, application, period, cost code, mapped account, kind, amount) plus a *By cost code* sheet.

## Permissions

API keys, webhooks, connections, mappings and the company export: company admins (and PMs). Accounting posting: `sub_pay_app.accounting_sync` (PM, finance). Project export: `sub_pay_app.export`. Values written by an API key are attributed to its owner in history.

## Walkthrough

1. Company › Integrations › API keys → **New key** *ERP sync*, scopes *RFIs read* + *Pay applications write* → copy the key → `curl -H "Authorization: Bearer octapm_…" /api/v1/projects/{id}/rfi` works; `POST …/submittals` answers 403.
2. Webhooks → **New webhook** to your endpoint with `change_order.*` → **Test** shows the endpoint's answer → approve a change order → *Deliveries* shows `change_order.approved` delivered with the signature; stop the endpoint, approve another → failed → dead after five attempts → **Redeliver** once it is back.
3. Accounting → **Connect** QuickBooks (sandbox) → map `*` to *Construction costs* → approve a pay application → *Posted bills* shows the bill number; mark it paid in the sandbox → **Check payments now** → the application is *Paid* with the payment reference.

## Tests

`backend/src/services/__tests__/api-client.service.test.js`, `webhook.service.test.js` (fan-out, signing, retries to dead, disable, redeliver, test), `accounting.service.test.js` (OAuth state + encrypted tokens, bill lines by cost code, bill creation against a fake QuickBooks, payment poll → payment recorded, mapping failures / outage retries, XLSX + CSV export) and `frontend/scripts/integrations-ui.test.mjs`.
