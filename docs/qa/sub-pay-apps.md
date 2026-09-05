# Subcontractor payment applications (OCTA-FIN-SUBPAY-021)

A subcontractor (or the QS on their behalf) claims against an **executed commitment** period by period. Claims are capped by the approved progress of the activity each SOV line points at, reviewed by the QS, approved by the PM behind a compliance gate, and paid by finance. Payments feed the project cash flow.

## Where

Project → Commercial → **Pay Applications** (`/projects/:id/commercial/pay-apps`). Deep link with `?source=sub_pay_app&recordId=…`.

## Lifecycle

`draft → submitted → under_review → approved → paid`, with `rejected` (→ back to draft) and `void` (draft/rejected only).

| Step | Who (base roles) | Party templates | Gate |
| --- | --- | --- | --- |
| Create / edit claims | PM, QS | contractor, subcontractor | commitment must be executed or closed; one open application per commitment (`SUB_PAY_APP_OPEN_EXISTS`, reason `DUPLICATE_PERIOD`) |
| Submit | PM, QS (`sub_pay_app.submit`) | contractor, subcontractor | at least one claim; **no line above its approved-progress cap** (`SUB_PAY_APP_OVER_CLAIM`, reason `OVER_APPROVED_PROGRESS`, lines listed) |
| Review | PM, QS (`sub_pay_app.review`) | — | note optional |
| Approve | PM (`sub_pay_app.approve`) | — | commitment insurance in order **and** lien waiver on file when required (`SUB_PAY_APP_COMPLIANCE`, reason `MISSING_COMPLIANCE`); over-claim needs an `overClaimOverrideReason`; compliance needs a `complianceOverrideReason` |
| Reject | PM, QS (`sub_pay_app.reject`) | — | code + reason required (`SUB_PAY_APP_REASON_REQUIRED`) |
| Record payment | PM, finance (`sub_pay_app.pay`) | — | Σ payments ≤ net (`SUB_PAY_APP_PAYMENT_EXCEEDS`); paid in full → `paid`, cash flow rebuilt |
| Void | PM (`sub_pay_app.void`) | — | reason required |

Owner and consultant parties are read-only; subcontractor parties only see applications on their own commitments (`commitment.vendorCompanyId`).

## Numbers

- Lines are seeded from the commitment's schedule of values with `previousAmount` = Σ this-period of earlier non-void applications.
- `capAmount = approvedPct × scheduledAmount`; `approvedPct` is the latest **approved** `ActivityProgress` of the line's activity (null → no cap).
- `cumulative = previous + thisPeriod` must not exceed scheduled (`SUB_PAY_APP_EXCEEDS_SCHEDULED`).
- `gross = Σ thisPeriod + Σ materialsOnSite`; `retention = gross × rate` (default = commitment retention rate); `net = gross − retention − backCharges`.
- `retentionCumulative` = retention held on earlier applications + this one.

## Walkthrough

1. Execute a commitment with an SOV (Commercial → Commitments). Approve progress on the activities its lines point at.
2. Pay Applications → **New application** → pick the commitment, period, toggle "Lien waiver required".
3. Enter this-period amounts (and materials on site); a line turns red when cumulative exceeds the approved cap. **Save claims** then **Submit** — an over-claim is refused with the offending lines.
4. As QS: Mark under review / Reject with a code. As PM: Approve — the compliance banner lists what is missing; override with a reason or upload the waiver (Evidence) and record its document id.
5. As finance: Record payment(s); the application flips to Paid when fully paid. Check Commercial → Cash Flow for the outflow in the paid month.
6. Statement PDF from the detail; history, attachments and comments live on the record.

## Verification

- `backend`: `npx jest src/services/__tests__/sub-pay-app.service.test.js` (cap/over-claim, financials, seeding, submit rejection, compliance gate + override, payments, visibility, PDF).
- `frontend`: `node scripts/pay-apps-ui.test.mjs`.
- OpenAPI: `node scripts/validate-openapi.js` (12 `/pay-apps` routes under **Commercial**).
