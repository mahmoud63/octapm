# OctaPM Mobile — Role Experiences

**Audience:** whoever implements UX2-A and UX2-B, and the reviewer certifying each role (§70).
**Date:** 2026-09-19. **Status:** design, built on the permission matrix as it actually is.

## 1. The nine roles, and why there is no tenth

`shared/permissions.json` defines **nine** roles over **thirty-seven** modules:

`pm` · `planning_eng` · `qs` · `cost_controller` · `procurement` · `warehouse` · `site_engineer` · `quality_engineer` · `finance`

The brief asks for ten experiences, the tenth being ADMIN. **There is no admin role.** `User.isCompanyAdmin` is a boolean overlay granting org-wide project visibility and user/permission administration. An admin is therefore whichever role they hold, plus an Administration group in More. And because `User.role` is a single org-wide value with no per-project override, **no user holds two roles** — §39's combined-navigation problem does not exist in this data model.

## 2. The measured permission matrix

Extracted from the policy, counting modules the role may read, may write (create/update/submit/approve/certify/baseline) and may approve:

| Role | reads | writes | approves | what it may approve |
|---|---:|---:|---:|---|
| `pm` | 37 | 34 | 27 | nearly everything |
| `qs` | 37 | 20 | 3 | progress, boq, change_event |
| `finance` | 36 | 9 | 4 | ipc, cost, commitment, sub_pay_app |
| `cost_controller` | 36 | 8 | 1 | timesheet |
| `planning_eng` | 35 | 24 | 4 | progress, meeting, task, inspection |
| `procurement` | 31 | 10 | 0 | — |
| `site_engineer` | 28 | 21 | 0 | — |
| `quality_engineer` | 28 | 21 | 4 | ncr, safety, inspection, punch |
| `warehouse` | 25 | 6 | 1 | inventory |

**The finding that decides the design: `site_engineer` and `quality_engineer` have identical read and write sets.** They differ only in what they may approve. So permissions alone cannot tell the two experiences apart — a purely permission-derived UI would give a quality engineer a site engineer's app. The differentiation has to come from **role identity**, which is precisely what the brief asks for. Navigation, Home and quick actions are chosen by role; what they may *do* is still gated by permission. Role decides the shape; permission decides the contents. Neither alone is enough.

Two other things fall out of the table and must be respected:

- **`cost_controller` writes almost nothing** (8 modules, approving only timesheets). Their app is a reading instrument, not a form. Giving them a capture button would be a lie about their job.
- **`warehouse` cannot read `progress`, `cost`, `ipc`, `commitment`, `change_event`, `eot`, `portfolio` or `email`.** A storekeeper Home that mentions progress or money is showing them something the server will refuse.

## 3. Project Manager — a management and exception experience

**Navigation:** Home · Needs You · Project · Controls · More
**Not** a field-entry app. No Capture in the bottom bar; capture stays available inside records.

### PM Home

Answers, in this order: what needs my decision, what is late, what is at risk, what changed, what is happening on site.

```
Good morning, Mohamed                      RIVERSIDE TOWER ▾
PROJECT HEALTH 86/100          ▓▓▓▓▓▓▓▓░░

TODAY
4 approvals · 2 overdue RFIs · 1 overdue NCR
3 activities behind · 2 deliveries due
$42,500 of changes awaiting your decision

NEEDS YOUR ATTENTION
CO-017  Commercial approval  $42,500   due today
RFI-034 Structural clarification        2 days overdue
NCR-012 Concrete defect — closeout awaiting approval

PROJECT PULSE
Schedule  SPI —        slip 1,006 d    ⚠ high
Cost      CPI 0.742    EAC $10.8m      overrun 34.7%
Critical driver: Unitised facade installation (1,040 d)
Quality   3 open NCRs
Procurement 2 late packages

TODAY ON SITE
142 workers · 1,136 man-hours · 9 companies
11 plant · 6 idle hrs · 6 deliveries · 4 visitors
3.5 hours lost · 18 photos

RECENT SITE PHOTOS   [ grid ]

Review approvals · Today's site report · Critical activities · Changes · Quality · Deliveries
```

**Every figure has a source and none is computed on the phone.** Health from `/projects/:id/health`; SPI, CPI, slip days, EAC, overrun, at-risk counts and the *named* critical driver from `/projects/:id/forecast`; the site block from `totals` on `/projects/:id/daily-logs/:today`; photos from `/projects/:id/photos`; approvals and overdue items from the assignments API.

**SPI came back `null` on the certified project.** It renders as an em-dash with the slip days beside it, never as a fabricated 1.00.

### PM Controls — the Project Control Center (§8)

One screen, eight sections, each a summary that opens the module scoped to this project: Overview · Schedule · Commercial · Cost · Procurement · Quality · Site · Documents · Risks. The point is to get from "the project is in trouble" to the specific record without touring unrelated modules.

## 4. Site Engineer — a field execution experience

**Navigation:** Today · Site · **Capture** · Drawings · More

### Today

```
RIVERSIDE TOWER ▾            Thu 19 Sep     ◉ Offline
TODAY'S WORK        5 activities
A-2000  RC frame to level 12        46% ▓▓▓▓░░  behind
        Level 12 · Zone B · drawing A-401 rev C
        ⚠ inspection required before pour
...
ASSIGNED TO YOU     3
BLOCKING            RFI-034 open 2 days on A-2000
MATERIALS NEEDED    cement 40 bags · rebar T16 2.1 t
DELIVERIES TODAY    2
INSPECTIONS DUE     1
```

Quick actions: Update progress · Take photo · Raise RFI · Daily report · Request material · Raise issue · Create task · Report delay · Quality observation — each gated by the matching permission, all of which this role holds except approval.

**"What am I building today" comes from the lookahead** (`/projects/:id/lookaheads`) and the activity register filtered to today's dates — both exist. Weather comes from the daily log's `weather` with its `weatherSource`, shown only when the feed has actually run.

## 5. Quality Engineer — the same hands, different job

**Navigation:** Today · Inspections · **Capture** · Issues · More

Identical permissions to the site engineer, so the difference is entirely one of emphasis and of the four things they alone may approve: **ncr, safety, inspection, punch**.

Their Today leads with inspections due and ITPs pending, then open NCRs by severity and ageing, then punch by trade, then closeouts **awaiting their approval** — which is the one thing a site engineer never sees. Quick actions: Inspection · NCR · Punch · Photo · Material test · Safety observation.

## 6. Storekeeper (`warehouse`) — a transaction experience

**Navigation:** Home · Scan · Receive · Issue · More

Writes only six modules and approves `inventory`. Their Home is a counter: deliveries expected today, goods awaiting receipt, issues requested, stock below minimum, items quarantined or damaged. **No progress, no cost, no commercial** — they cannot read those.

Scan is a first-class destination because it is how this role starts most transactions. Quick actions: Scan · Goods receipt · Issue · Transfer · Damage · Photo.

## 7. Procurement — an expediting experience

**Navigation:** Home · Orders · Deliveries · Suppliers · More

Approves nothing; their job is chasing. Home leads with late packages, long-lead alerts (`/projects/:id/long-lead`), orders awaiting delivery, and lead-time risks. `Suppliers` is real: `/projects/:id/procurement` returns `{suppliers, packages, orders, alerts, summary}`.

## 8. Planning Engineer — a schedule experience

**Navigation:** Home · Schedule · Lookahead · Progress · More

Writes 24 modules and approves progress, meeting, task and inspection. Home leads with critical-path movement, activities behind, float consumed, the named critical driver from the forecast, delays awaiting classification, and progress submissions **awaiting their approval**.

## 9. QS / Commercial — a change and valuation experience

**Navigation:** Home · Needs You · Commercial · Changes · More

Approves progress, boq and change_event. Home leads with change events awaiting pricing, changes awaiting decision with their value, valuations due, EOT exposure, and the commercial position from `/cost/summary` and `/forecast.cost`.

## 10. Cost Controller — a reading instrument

**Navigation:** Home · Needs You · Cost · Commercial · More

Writes eight modules, approves timesheets only. Home is analytical: committed against budget, actual against earned, EAC and overrun from `/forecast.cost`, cost at risk, timesheets awaiting approval. **No Capture** — it would misrepresent the role.

## 11. Finance — an approval and certification experience

**Navigation:** Home · Needs You · Commercial · Reports · More

Approves ipc, cost, commitment and sub_pay_app — the money. Home leads with certificates awaiting certification, pay applications awaiting approval, retention held, cash flow from `/projects/:id/cash-flow`, and invoices against receipts. `Reports` points at the org-level `/reports`; **there is no per-project reports endpoint** and the screen must not imply one.

## 12. Admin overlay

`isCompanyAdmin` adds an **Administration** group to More: users, permissions, companies, project parties — backed by `user_management` and `project_parties`, which only `pm` and `planning_eng` can write by default. It does not change the bottom bar.

## 13. What each role must be certified on (§70)

For every role, separately: Home, navigation, quick actions, the pages they reach, Needs You, photo access, the areas they are correctly refused, and the dashboard effect of what they do. A role passes only if a person in that job can complete their core loop without leaving the app, and is never offered a control the server would refuse.
