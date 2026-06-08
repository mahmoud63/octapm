# Project Details — Feature Audit
> Source of truth: PMcopilots BRD v3 (11 March 2026)  
> Scope: everything visible when a user opens a project's detail page  
> Date: 2026-04-13

---

## Legend
- ✅ **Implemented** — working in both backend and frontend
- ⚠️ **Partial** — scaffolded or half-done; not production-ready
- ❌ **Not implemented** — required by BRD, zero code exists
- 🔵 **Extra** — implemented but NOT in BRD (built beyond spec)

---

## 1. Project Header & Info

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| Project name display | BR-003 | ✅ | Shown as page heading |
| Start / end date display | §14.1 Master Data | ✅ | Formatted below name |
| Status badge | §12 Roles | ✅ | `ProjectStatusBadge` component |
| Project type | §14.1 | ✅ | Overview tab |
| Project location | §14.1 | ✅ | Overview tab |
| Currency | §14.1 | ✅ | Overview tab |
| Contract value display | §14.1 | ❌ | Field exists in DB schema but not shown |
| Project duration | §14.1 | ❌ | Not shown in overview |

---

## 2. Schedule Generation Module (FR-101 – FR-107)

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| BOQ file upload (xlsx/xls/csv) | FR-101, AC-01 | ✅ | Drag-drop + click, 50 MB limit |
| AI schedule generation pipeline | FR-101 | ⚠️ | Only **1 pass** (schedule + CPM). BRD requires **3 passes** (core schedule → risks/procurement → resources). Resources pass is missing. |
| BOQ chunking for >60 items | FR-102, BR-005 | ❌ | No chunking logic. Single AI call truncates large BOQs. |
| Input validation before generation | FR-103 | ⚠️ | Backend validates file presence only. No pre-check for project name, start date, ≥2 BOQ items with sections. |
| 3-step progress indicator (1/3, 2/3, 3/3) | FR-104 | ⚠️ | Shows `currentStep` text from job polling but no labelled 3-step bar with phase descriptions. |
| JSON repair on truncated AI response | FR-105 | ❌ | Not implemented. Truncated responses throw parse error. |
| Rate limit / 429 / 529 handling | FR-106 | ❌ | API errors bubble as 500. No retry or reset-countdown UI. |
| Revision history storage | FR-107 | ✅ | `ScheduleRevision` table; `snapshotJson` stores full AI output; timestamp + label + counts saved. |
| Revision comparison view | FR-107 | ❌ | Stored but no UI to compare revisions. |
| Regenerate from new file | — | ✅ | "Regenerate from new file" button on dashboard. |
| Schedule persisted to DB (load without re-calling AI) | BR-003 | ✅ | `Activity` + `ScheduleRevision` tables; `GET /schedule` returns DB data. |
| Async job pattern (no browser timeout) | — | ✅ 🔵 | 202 + polling every 3s. Not in BRD but essential. |

---

## 3. Gantt Chart (FR-104 context, BRD §9.1)

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| SVG Gantt chart | BRD §9.1 | ✅ | Pure SVG, no external library |
| Sticky label column | — | ✅ | Left panel with activity names |
| Month / day timescale | — | ✅ | M1…Mn + d0…dN ticks |
| Critical path bars (red) | BRU-01 | ✅ | Red fill with diagonal stripe |
| Non-critical bars (blue) | — | ✅ | |
| Milestone diamond (purple) | §9.1 | ✅ | |
| Total float bar (teal extension) | BRU-01, BRU-11 | ✅ | |
| Progress fill overlay (% complete) | FR-301 | ✅ | Overlaid on bar |
| FS dependency arrows | §9.1 | ✅ | Right-angle routing, red on crit-to-crit |
| Hover tooltip (name, d range, float, %) | — | ✅ | |
| Today line | — | ✅ | Day 30 placeholder (not calendar-aware) |
| Near-critical activity indicator (TF 1–5 days, orange) | BRU-11 | ❌ | No orange highlight; TF=1-5 treated same as any non-critical |
| Gantt editor (drag bars, edit predecessors) | RSK-01 | ❌ | View only — no editing on Gantt |
| Baseline vs actual bar comparison | FR-107 | ❌ | No baseline bar overlay |

---

## 4. Activities Table (Schedule Dashboard → Activities tab)

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| WBS code column | FR-201 | ✅ | |
| Activity name | FR-201 | ✅ | |
| Phase / category | — | ✅ | |
| Duration (days) | FR-201 | ✅ | |
| Early Start / Early Finish | FR-204 | ✅ | Working days from day 0 |
| Total Float | BRU-01 | ✅ | |
| Budget | FR-401 | ✅ | |
| Status badge | BRU-12 context | ✅ | todo / in_progress / complete / delayed |
| % complete | FR-301 | ✅ | Display only |
| Progress slider (update % interactively) | FR-301 | ❌ | Activities tab shows % but no editable slider |
| Late Start / Late Finish | FR-204 | ❌ | Stored in DB but not shown |
| Predecessors column | FR-201 | ❌ | Stored; not shown in table |
| Actual start / actual finish | FR-205 | ❌ | Not shown |
| CRUD on activities (separate Activities tab) | — | ✅ 🔵 | Separate tab with create/edit/delete dialogs |

---

## 5. Critical Path Tab

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| List of critical activities with badge | BRU-01 | ✅ | Numbered list, red styling |
| WBS, category, duration, day range shown | BRU-01 | ✅ | |
| Days slippage / behind indicator | BR-008, §15 | ❌ | No slippage calculation shown |
| Float trending toward zero alert | BR-008 | ❌ | No predictive warning |

---

## 6. Milestones Tab

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| Milestone cards with name, phase, day | §9.1 | ✅ | Grid layout |
| Critical path flag on milestone | BRU-01 | ✅ | "CP" badge |
| Description | — | ✅ | |
| Countdown to next milestone | BR-006, §15 | ❌ | No countdown shown |
| Milestone completion status | FR-301 | ❌ | No tick/done status |

---

## 7. Risks Tab

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| Risk table (ref, description, probability, impact, severity, mitigation, phase) | §15 | ✅ | Full table rendered |
| Colour-coded severity badge | BRU-10 | ✅ | |
| Add / edit risk manually | §15 | ❌ | Read-only from AI output; no CRUD |
| Risk owner assignment | §15 | ❌ | Not captured by AI or stored |
| Risk status tracking (open/closed) | §15 | ❌ | No status field |

---

## 8. Long Lead Items Tab

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| Long lead item cards (item, lead weeks, order-by, activity, criticality, risk) | FR-503 context, §9.1 | ✅ | Orange highlight for ≥12w items |
| Urgent icon for high lead times | — | ✅ | AlertTriangle icon |
| Link to activity in schedule | FR-503 | ❌ | `activity` field shown as text only; no navigation |
| CRUD for long lead items | — | ❌ | Read-only from AI output |

---

## 9. WBS Tab

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| WBS table (code, name, duration, budget, activity count, responsible) | FR-201 | ✅ | Indented by level |
| WBS hierarchy collapse/expand | FR-201 | ❌ | Flat list only |
| WBS budget rollup chart | — | ❌ | No chart |

---

## 10. Real-Time Progress & Earned Value (FR-301 – FR-306)

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| Progress slider per activity (0-100%) | FR-301 | ❌ | No interactive slider anywhere in project details |
| Actual cost auto-derivation on progress update | FR-302 | ❌ | |
| EV metrics: PV, EV, AC computed | FR-303 | ❌ | |
| SPI / CPI calculation | FR-303, BRU-02/03 | ❌ | |
| EAC = Total Budget / CPI | BRU-04, FR-403 | ❌ | |
| S-curve chart (PV vs EV vs AC) | §15 | ❌ | |
| Bulk progress update | FR-305 | ❌ | |
| EV summary bar (SPI, CPI, Planned %, Actual %, Days Behind) | FR-306 | ❌ | |
| SPI/CPI alert when <0.9 | FR-304, §13.3 | ❌ | |

---

## 11. Cost Control Module (FR-401 – FR-405)

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| Activity-linked cost with 7 categories (Labour, Material, Equipment, Subcontract, Indirect, Overhead, Contingency) | FR-401 | ❌ | |
| Budget vs Committed vs Actual vs Forecast per activity | FR-402 | ❌ | |
| 3-scenario EAC (Optimistic -10%, Most Likely, Pessimistic +15%) | FR-403 | ❌ | |
| Daily burn rate chart with budget rate line | FR-404 | ❌ | |
| Phase-level cost aggregation + variance analysis | FR-405 | ❌ | |

---

## 12. Commercial Management Module (FR-501 – FR-505)

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| Change order register (status workflow) | FR-501 | ❌ | |
| IPC client invoice workbook | FR-502 | ❌ | |
| Retention calculation (default 5%) | BRU-06 | ❌ | |
| Subcontractor valuation register | FR-503 | ❌ | |
| Budget revision register | FR-504 | ❌ | |
| Cash flow projection | FR-505 | ❌ | |
| EOT claim builder (5-step wizard) | BR-007, AC-07 | ❌ | |
| LD calculation | BRU-05 | ❌ | |
| Weather delay tracker (70% allowance warning) | BRU-09 | ❌ | |

---

## 13. Quality & HSE Module (FR-601 – FR-605)

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| ITP register (hold/witness/review points) | FR-601 | ❌ | |
| NCR register (severity, disposition) | FR-602 | ❌ | |
| Defect/snagging list | FR-603 | ❌ | |
| Safety incident log | FR-604 | ❌ | |
| Material test results register | FR-605 | ❌ | |
| Quality Score calculation | BRU-10 | ❌ | |

---

## 14. Document Control Module (FR-701 – FR-705)

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| RFI register | FR-701 | ❌ | |
| Submittal register | FR-702 | ❌ | |
| Drawing register | FR-703 | ❌ | |
| Transmittal log | FR-704 | ❌ | |
| Correspondence register | FR-705 | ❌ | |

---

## 15. P6 / MSP Import (FR-201 – FR-206)

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| P6 XER file import | FR-201 | ❌ | Upload zone only accepts xlsx/xls/csv; no XER parsing |
| P6 XML import | FR-202 | ❌ | |
| MSP XML import | FR-203 | ❌ | |
| CPM recalculation after import | FR-204 | ❌ | |
| Progress data import from P6 | FR-205 | ❌ | |
| Linked module auto-build after import | FR-206 | ❌ | |

---

## 16. Export & Reporting (BR-010, AC-06)

| Feature | BRD Ref | Status | Notes |
|---------|---------|--------|-------|
| Excel export (multi-sheet: Master Schedule, Critical Path, Risks, Assumptions, Long Lead, WBS) | BR-010, AC-06 | ❌ | |
| PDF export (browser print) | BR-010 | ❌ | |
| Weekly progress report | §15 | ❌ | |
| Earned value report | §15 | ❌ | |

---

## 17. Extra Features (Not in BRD — Built Beyond Spec)

| Feature | Notes |
|---------|-------|
| Equipment tab in project details | Materials/equipment tracking exists in DB + frontend (`EquipmentSection`, `MaterialsSection` hooks). Not mentioned in BRD as a project-detail tab. |
| Materials section (backend + hooks) | `materials.js` route + `use-materials.ts` hook exist; not surfaced in project detail UI yet. |
| Async job polling (202 + `GET /job/:jobId`) | BRD assumes synchronous generation; async pattern was built to avoid browser timeouts. |
| Cache-Control: no-store on schedule routes | Defensive; not specified in BRD. |
| `near-critical` float colour (TF 1-5d): BRU-11 known, just not wired | Stored in DB; orange highlight not rendered. |

---

## Summary Counts

| Status | Count |
|--------|-------|
| ✅ Implemented | ~35 |
| ⚠️ Partial | 5 |
| ❌ Not implemented | ~55 |
| 🔵 Extra (beyond BRD) | 4 |

---

## Priority Order for Next Implementation (Phase 1a MVP)

Based on BRD priority (`Critical` → `High` → `Medium`):

1. **Progress sliders + EV metrics** (FR-301–306) — Critical. Foundation for every health score and dashboard metric.
2. **BOQ chunking for large files** (FR-102) — High. Blocks real-world usage with >60-item BOQs.
3. **3-pass AI generation** (FR-101) — High. Resources pass adds procurement/resource data missing from current single pass.
4. **JSON repair + rate limit handling** (FR-105, FR-106) — High. Production reliability.
5. **Cost Control tab** (FR-401–405) — Critical per BRD. Activity-linked 7-category cost breakdown.
6. **P6/MSP import** (FR-201–206) — High. Major differentiator for teams with existing schedules.
7. **Commercial management** (FR-501–505) — High. IPC, change orders, cash flow.
8. **Quality & HSE** (FR-601–605) — High.
9. **Document control** (FR-701–705) — Medium.
10. **Excel/PDF export** (BR-010) — High.
