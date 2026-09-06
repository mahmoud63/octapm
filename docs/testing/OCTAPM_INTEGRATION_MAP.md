# OctaPM module integration map

The question this answers is not "does each module work" but "does data cross
between them without anyone retyping it". Every **Tested** row was exercised
against a running API and then verified in the database — the API returning 200
is not accepted as evidence that a link exists.

Status: ✅ works · 🟡 partial · 🔴 broken · ⚪ not implemented · ❓ untested here

## Tested connections

| Source | Target | Expected connection | Observed | Status |
| --- | --- | --- | --- | --- |
| RFI | Change Order | Cost-impact RFI initiates a change | `POST /rfi/{id}/convert-to-change` creates a draft CO, carries `costImpactAmount` → `value` and `scheduleImpact`, sets `rfi.changeOrderId`, and refuses a second conversion with 409 | ✅ |
| RFI | Change Event | Cost-impact RFI enters vendor pricing | No path. The endpoint named `convert-to-change` produces a ChangeOrder, not a ChangeEvent — see GAP-INT-001 | 🔴 |
| Change Event | Change Order | Priced event becomes a CO | `POST /change-events/{id}/convert` creates the CO with the value intact, sets `changeEvent.changeOrderId`, moves the event to `converted` | ✅ |
| Change Order | Approval workflow | Status transitions are governed and audited | Draft → submitted → approved enforced; an out-of-order approve is refused with 409; every transition writes an `ApprovalWorkflowEvent` | ✅ |
| Change Order | Governance control | A variation cannot be approved without analysis | Submit refused with `CHANGE_ORDER_IMPACT_SUMMARY_REQUIRED`, then `CHANGE_ORDER_IMPACT_PROOF_REQUIRED` until an affected activity **and** a supporting document exist | ✅ |
| Change Order | Budget | Approved CO moves the revised budget | Not observed: the seeded project has no budget lines, and approval is blocked behind the evidence control above | ❓ |
| Company | Project (templates) | A shared template is usable on any project | Company template appears in `/projects/{id}/forms/templates` | ✅ |
| Company | Audit | Org-level actions leave a trail | Now writes `AuditEvent` with `projectId = null` — was completely broken (BUG-AUDIT-001) | ✅ |
| Inspection | Punch item | A failed item raises a tracked defect | Endpoint exists (`/forms/{id}/items/{itemId}/deficiency`); the seeded template produced no items to fail, so the link itself is unverified | 🟡 |
| Activity progress | Earned value | Approved progress drives the dashboard | Approved `ActivityProgress` rows exist and the health dashboard renders, but it exposes `overallScore` and `dimensions` rather than a percent complete, so a like-for-like comparison was not possible | 🟡 |
| Project | Tenant isolation | Another company cannot reach this project | 8 cross-tenant reads and 1 cross-tenant write all refused; no stray row written | ✅ |
| Search | Permissions | Search does not reveal inaccessible records | Outsider search returns `items: []`, `authorizedProjectCount: 0` | ✅ |
| Every module | Permission policy | The API enforces the declared policy | 28 modules × 8 roles = 224 probes, 0 mismatches (after fixing BUG-PERM-001 and -002) | ✅ |

## Declared but not yet exercised

These connections exist in code and have endpoints, but this pass did not build
the preconditions to drive them end to end. They are listed so the gap is
explicit rather than implied.

| Source | Target | Endpoint that should carry it |
| --- | --- | --- |
| Bid package | Commitment | `POST /bids/{packageId}/award/confirm` |
| Commitment | Sub pay application | `POST /pay-apps` capped by approved progress |
| Sub pay app | Cash flow | `POST /pay-apps/{id}/payments` → `rebuildCashFlow` |
| Direct cost | Budget actual | `POST /direct-costs/{id}` approve → budget line actual |
| Timesheet | Budget actual | `POST /timesheets/{id}/approve` → labour cost posting |
| Drawing | RFI / Punch | Sheet pins raising an RFI or punch item |
| Drawing revision | Sheet references | Supersede and reference integrity across revisions |
| Change event | RFQ → vendor quote | `POST /change-events/{id}/rfqs`, vendor portal, `accept` |
| Submittal | Schedule | `applyScheduleImpact` → `WorkflowActivityLink` |
| Daily log | Weather delay | `logWeatherDelay` → `weather.service.createWeatherDelay` |
| Meeting | Action items | Carry-forward of unresolved items to the next meeting |
| Report builder | Every register | 20 report sources, permission-filtered per caller |

## Notes on what "connected" means here

A connection is only marked ✅ when three things were true:

1. The API accepted the action and returned the new record's id.
2. The row exists in the database with the correct `projectId` and `orgId`.
3. The **link column** is populated in both directions where the schema has one
   (`rfi.changeOrderId` and `changeEvent.changeOrderId` were both checked), and
   any value that should have transferred matches to the cent.

Where a value transfer was claimed, it was tested by sending **no value at all**
and confirming the target picked it up from the source — that is the only way to
prove nothing is being retyped.
