# Calculation Certification Plan

Status: pending external certification. Local automated tests cover important
CPM, EV, BOQ allocation, and IPC behaviors, but no independent Primavera,
Excel, or finance-controller comparison pack has been attached.

## Current Local Coverage

| Area | Implemented coverage | Local evidence | Certification status |
| --- | --- | --- | --- |
| CPM | Structured FS, SS, FF, SF relationships; lag/lead; cycle detection; critical path explanation; working calendars. | `backend/src/services/__tests__/cpm.service.test.js` passes in the backend suite. | Not independently certified against Primavera P6. |
| EV | PV from approved cost loading; EV from approved progress and approved BOQ allocations; AC from official cost records; SPI/CPI/EAC; locked reporting period snapshots. | `backend/src/services/__tests__/earned-value.service.test.js` passes in the backend suite. | Not independently reconciled to a controller workbook. |
| IPC | Approved allocation basis; approved change-order allowance; progress caps; retention; invoice/payment/retention release controls. | `backend/src/services/__tests__/ipc-allocation-impact.test.js` and IPC workflow tests pass in the backend suite. | Not independently finance-certified. |
| BOQ/activity linkage | Official value basis is `ActivityBoqAllocation`; over-allocation and duplicate checks are covered. | BOQ allocation tests pass in the backend suite. | Needs pilot workbook reconciliation. |

## Required External Fixtures

| Fixture group | Required scenarios | Reference source | Evidence required |
| --- | --- | --- | --- |
| CPM | FS, SS, FF, SF, positive lag, negative lag, milestone, multiple critical paths, cycle detection, unsupported calendar/constraint warning. | Primavera P6/XER or approved planning workbook. | Input file, expected dates/floats/critical path, PMcopilots output, variance notes, Planning signoff. |
| EV | PV, EV, AC, SPI, CPI, EAC, locked reporting period, approved vs unapproved progress. | Finance/control Excel workbook. | Workbook, PMcopilots report JSON/screenshot, reconciliation table, Product/Finance signoff. |
| IPC | Current certified value, cumulative certified value, previous certified value, retention withheld/released, over-certification prevention, change-order inclusion/exclusion. | QS/Finance payment certificate workbook. | Workbook, PMcopilots IPC JSON/export, variance notes, QS/Finance signoff. |

## Pilot Use Rule

Until the external fixtures above are completed, PMcopilots calculation outputs
are advisory only. Primavera, Excel, and the existing payment/document control
process remain the contractual source of truth. Any controlled shadow pilot must
require human review and reconciliation before decisions are made from CPM, EV,
or IPC outputs.

## Required Signoff

| Owner | Required decision | Status |
| --- | --- | --- |
| Planning lead | CPM comparison accepted or defects filed. | Pending |
| QS/Finance lead | IPC and retention comparison accepted or defects filed. | Pending |
| Product/Business owner | Advisory-only wording accepted for pilot. | Pending |
| QA lead | Evidence archived for the release commit. | Pending |
