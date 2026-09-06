# OctaPM defect register

Every entry below was **reproduced against a running API and a real PostgreSQL
database**, not inferred from reading code. Fixed entries were re-tested by
re-running the scenario that found them.

Status key: **Fixed** (fix applied and retested) · **Open** (reproduced, not
fixed) · **By design** (investigated, not a defect).

| ID | Severity | Priority | Module | Summary | Status |
| --- | --- | --- | --- | --- | --- |
| BUG-AUDIT-001 | Blocker | P0 | Company / Audit | Company-scoped records could not be created at all | Fixed |
| BUG-WORKFLOW-001 | Blocker | P0 | Change orders / Workflow | A Decimal in workflow metadata killed the transaction | Fixed |
| BUG-PERM-001 | Critical | P0 | Commercial | Change-order register readable by every role | Fixed |
| BUG-PERM-002 | Critical | P0 | Commercial | EOT claim register readable by every role | Fixed |
| **FE-001** | **Critical** | **P0** | **Auth / frontend** | **A transient failure on the session check logged the user out** | **Fixed** |
| **FE-002** | **Critical** | **P0** | **Reports** | **The Reports page crashed: `sources` returned as an unresolved Promise** | **Fixed** |
| **FE-003** | **Major** | **P1** | **Frontend / dates** | **Every calendar date displayed a day early west of UTC** | **Partially fixed** |
| BUG-API-001 / FE-004 | Minor | P2 | API-wide | Five different list envelope shapes across endpoints | Open |
| FE-005 | Minor | P3 | Billing | Subscription re-fetched on every navigation, trips its limiter | Open |
| FE-006 | Minor | P3 | Company | No client-side validation on the cost code form | Open |
| GAP-INT-001 | Major | P1 | RFI / Change events | An RFI cannot enter the change-event pricing flow | Open |
| GAP-UI-001 | Major | P1 | Procurement | Backend, permissions and a user role exist; no interface | Open |
| GAP-AUDIT-002 | Major | P1 | Audit | Company-level audit was silently swallowed in 3 services | Fixed (root cause) |

Frontend defects FE-001 to FE-006 are documented in full in
`OCTAPM_FRONTEND_TECHNICAL_DEFECTS.md`; each was found by driving a real browser
and each fix was retested the same way.

---

## BUG-AUDIT-001 — Company-scoped records cannot be created

**Severity** Blocker · **Priority** P0 · **Module** Company workspace, Audit ·
**Scenario** S-COMPANY-001 · **Status** Fixed, retested

### Description

Creating any company-level (organisation-scoped) record failed outright with
HTTP 400 `AUDIT_EVENT_INVALID`. The company template library — a shipped,
documented feature with its own page at `/company/form-templates` — was
completely unusable. A construction company could not define a single shared
inspection checklist, ITP or toolbox-talk template.

### Steps to reproduce

```
POST /api/v1/company/form-templates
{ "name": "Concrete pour checklist", "type": "inspection",
  "sections": [{ "title": "Pre-pour", "items": [{ "label": "Rebar checked", "type": "pass_fail" }] }] }
```

**Expected** 201 with the created template.
**Actual** `400 {"success":false,"error":{"code":"AUDIT_EVENT_INVALID",
"message":"Audit events require org, project, entity, and action metadata"}}`

### Root cause

`AuditEvent.projectId` and `RecordHistorySnapshot.projectId` were both `NOT
NULL`. A company-scoped entity has no project by definition, so the audit write
inside `createTemplate`'s transaction always threw and rolled the whole creation
back.

The same call exists in four services. Two swallowed the failure with
`.catch(() => null)` — meaning company-level actions were silently unaudited
(see GAP-AUDIT-002) — and two did not, so those failed loudly.

### Files

- `backend/prisma/schema.prisma` — `AuditEvent`, `RecordHistorySnapshot`
- `backend/src/services/audit.service.js` — the `recordEvent` guard
- `backend/src/services/form.service.js:294`
- `backend/src/services/submittal-workflow.service.js:135`

### Fix

Migration `20260913090000_audit_event_company_scope` drops `NOT NULL` from
`projectId` on both tables, and `recordEvent` no longer requires it. This is
non-destructive: existing rows keep their project. It fixes the two loud
failures and restores the audit trail for the two silent ones.

### Retest

S-COMPANY-001 passes: the template is created, the audit row is written with
`projectId = null`, and the template is selectable from inside a project.

---

## BUG-WORKFLOW-001 — A Decimal in workflow metadata kills the transaction

**Severity** Blocker · **Priority** P0 · **Module** Change orders, Approval
workflow · **Scenario** S-INT-001 · **Status** Fixed, retested

### Description

Creating a change order threw a Prisma serialization error and rolled back. The
approval-workflow event writes a JSON metadata column built from the raw
database row, so money arrived as a `Prisma.Decimal`. `compactJson` treated it
as a plain object and walked its internals, producing
`{ constructor: [Function], s: 1, e: 0, d: [0] }`, which Prisma then refused to
write.

Because `recordTransition` runs inside the creating transaction, the whole
change order was lost — not just its audit entry.

### Steps to reproduce

```
POST /api/v1/projects/{id}/rfi/{rfiId}/convert-to-change   → 500
```

**Expected** 201 with the draft change order.
**Actual** `Invalid value for argument 'constructor': We could not serialize
[object Function] value.`

### Why the unit tests missed it

All 1580 unit tests mock Prisma, so `row.value` is a plain JavaScript number in
every one of them. A `Decimal` only exists when a real database is on the other
end. This is precisely the class of defect the scenario harness was built to
catch.

### Files

- `backend/src/services/approval-workflow.service.js` — `compactJson`
- `backend/src/services/change-order.service.js:916, 1254, 1462` — three call
  sites passing raw rows

### Fix

`compactJson` now converts a Decimal to a number, alongside the `Date` branch it
already had. Fixing it at the write site protects every record type that uses
this workflow service — submittals, commitments and pay applications all pass
raw rows the same way.

### Retest

New unit test `approval-workflow-decimal-metadata.test.js` pins the behaviour
including nested and array cases. S-INT-001 passes end to end.

---

## BUG-PERM-001 — Change-order register readable by every role

**Severity** Critical · **Priority** P0 · **Module** Commercial ·
**Scenario** S-PERM-001 · **Status** Fixed, retested

### Description

`GET /projects/{id}/change-orders` had no permission guard. Warehouse,
procurement and site-engineer accounts could read the full change-order
register — descriptions, values, approval status — which the permission policy
restricts to PM, planning engineer, QS, cost controller and finance.

The route file guards `submit` and `approve` with `requirePermission` but the
list handler had none, and the OpenAPI operation declared no `permissions`
block, so it defaulted to all eight roles. Policy, contract and enforcement all
disagreed.

### Steps to reproduce

Sign in as `warehouse@octapm.demo`, then `GET /projects/{id}/change-orders`.

**Expected** 403. **Actual** 200 with the full register.

### Files

- `backend/src/routes/change-orders.js:18`
- `backend/src/openapi/spec.js` — `listChangeOrders`

### Fix

Added `requirePermission("change_order", "read")` to the handler and
`modulePermission("change_order", "read")` to the spec, so the published
contract is derived from the policy rather than defaulted.

### Retest

S-PERM-001 passes. The generated permission matrix shows the three roles
correctly refused.

---

## BUG-PERM-002 — EOT claim register readable by every role

**Severity** Critical · **Priority** P0 · **Module** Commercial ·
**Scenario** Permission matrix generation · **Status** Fixed, retested

### Description

Identical to BUG-PERM-001 on `GET /projects/{id}/eot`. Extension-of-time claims
carry delay entitlement and the commercial case behind it. Procurement,
warehouse and site engineers could read them all.

Found only because the permission matrix is generated by probing every module
with every role rather than by reading the policy — the first pass reported this
as the one remaining mismatch out of 224 probes.

### Files

- `backend/src/routes/eot.js:28`
- `backend/src/openapi/spec.js` — `listEotClaims`

### Fix

Added `requirePermission("eot", "read")` and the matching spec declaration.

### Retest

Permission matrix regenerated: **0 mismatches across 28 modules × 8 roles.**

---

## GAP-AUDIT-002 — Company-level actions were silently unaudited

**Severity** Major · **Priority** P1 · **Module** Audit ·
**Status** Fixed by the BUG-AUDIT-001 root-cause fix

`report-builder.service.js:664` and `workflow-engine.service.js:266` wrapped
their company-level audit calls in `.catch(() => null)`. The calls always
failed, so creating a shared report definition or workflow template left no
audit trail at all — silently. Making `projectId` nullable means those writes
now succeed.

---

## BUG-API-001 — `activities` returns a bare array

**Severity** Minor · **Priority** P2 · **Module** Schedule ·
**Scenario** S-INT-005 · **Status** Open

`GET /projects/{id}/activities` returns the array directly as `data`, where
comparable list endpoints return `{ items, pagination }` or `{ rows, pagination
}`. Every client — including the mobile team consuming the same Swagger — has to
special-case this one endpoint, and it cannot paginate.

**Recommended fix** Wrap it in the standard envelope. This is a breaking change
for existing callers, so it belongs in a versioned change with the frontend
updated in the same commit, not a drive-by fix during a QA pass.

---

## GAP-INT-001 — An RFI cannot enter the change-event pricing flow

**Severity** Major · **Priority** P1 · **Module** RFI / Change events ·
**Scenario** S-INT-001 · **Status** Open, by design but incomplete

`POST /rfi/{id}/convert-to-change` is served by `convertToChangeEvent`, but it
creates a **ChangeOrder** directly. The Change Event module exists separately
with its own RFQ-to-vendor pricing flow, and an RFI cannot reach it.

The consequence for the workflow in section 16 of the QA brief: a site condition
found through an RFI cannot be priced by subcontractors before becoming a change
order. The PM must either raise a separate change event by hand and retype the
information, or skip vendor pricing entirely.

What does work: the conversion transfers the RFI's `costImpactAmount` and
`scheduleImpact` without re-entry, links the RFI forward to the change order,
and refuses a second conversion. So the direct path is sound — it is the pricing
detour that is missing.

**Recommended fix** Either add a `POST /rfi/{id}/convert-to-change-event`
alongside the existing route, or give the existing one a `target` parameter.
Rename `convertToChangeEvent` to match whatever it actually produces.
