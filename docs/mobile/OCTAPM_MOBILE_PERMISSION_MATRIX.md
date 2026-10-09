# OctaPM Mobile — Permission Matrix

**Source:** generated from `shared/permissions.json` (policy version 2026-09-05-v7-locations) by `mobile/scripts/permission-matrix.mjs` on 2026-09-18. Do not edit by hand; regenerate after a policy change. The backend enforces this same file; the app never grants what is not here.

**How the app uses it.** The server is the authority: every request is authorized on the server with the access token, and `GET /auth/me/permissions?projectId=` returns the effective matrix for the signed-in person on a project (org role, project assignment, party role and permission templates resolved). The app reads that answer to decide what to render. The tables below are the org-role baseline from the shared policy; a project template can narrow or widen them, which is why the server answer wins. A `403` from the server is always a refusal for that record, never a reason to sign out.

**Reading the tables.** Role columns: PM = Project Manager, Plan = Planning Engineer, QS = QS, Cost = Cost Controller, Proc = Procurement, Store = Warehouse, Site = Site Engineer, Qual = Quality Engineer, Fin = Finance. Actions are the nine policy actions; transitions are the named workflow steps a route additionally requires. The "Mobile" column says in which milestone of the implementation plan the module reaches the app, or that it stays web-only.

## Module overview

| Module | Mobile | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin | Parties with read |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Schedule (`schedule`) | M3 | approve | edit | view | view | view | view | view | view | view | owner, consultant, contractor, subcontractor |
| Progress (`progress`) | M3 | approve | approve | approve | view | · | · | edit | edit | view | owner, consultant, contractor, subcontractor |
| BOQ (`boq`) | web only | approve | edit | approve | view | view | view | view | view | view | owner, consultant, contractor, subcontractor |
| IPC (`ipc`) | web only | approve | · | edit | view | · | · | · | · | approve | owner |
| Cost Control (`cost`) | web only | approve | view | edit | edit | · | · | · | · | approve | owner |
| Procurement (`procurement`) | M5/M6 | approve | edit | view | view | edit | edit | edit | edit | view | owner, contractor |
| Inventory & Warehouse (`inventory`) | M5 | approve | view | view | view | edit | approve | edit | edit | view | — |
| Risk Register (`risk`) | M3 (view) | approve | edit | edit | view | view | view | view | view | view | owner, consultant, contractor |
| User Management (`user_management`) | web only | approve | view | view | · | · | · | · | · | · | — |
| Project Parties (`project_parties`) | web only | approve | edit | view | view | view | view | view | view | view | owner, consultant, contractor, subcontractor |
| Reports (`report`) | web only | edit | edit | edit | edit | edit | view | edit | edit | edit | owner, consultant, contractor, subcontractor |
| Workflows (`workflow`) | M6 | approve | edit | edit | edit | edit | edit | edit | edit | edit | owner, consultant, contractor, subcontractor |
| Custom fields (`custom_field`) | M2 | edit | view | view | view | view | view | view | view | view | owner, consultant, contractor, subcontractor |
| Assistant (`assistant`) | later | view | view | view | view | view | view | view | view | view | owner, consultant, contractor, subcontractor |
| Bid Management (`bid`) | web only | approve | view | edit | view | edit | · | · | · | view | — |
| Portfolio (`portfolio`) | web only | view | view | view | view | view | · | · | · | view | — |
| Audit History (`audit`) | M2 (history) | view | view | view | view | view | view | view | view | view | owner, consultant, contractor, subcontractor |
| Document Control (`document_control`) | M2 | approve | edit | view | view | view | view | edit | edit | view | owner, consultant, contractor, subcontractor |
| RFI (`rfi`) | M2 | approve | edit | view | view | view | view | edit | edit | view | owner, consultant, contractor, subcontractor |
| Submittal (`submittal`) | M2 | approve | edit | view | view | view | view | edit | edit | view | owner, consultant, contractor, subcontractor |
| Commitments (`commitment`) | M6 (view) | approve | view | edit | view | edit | · | · | · | approve | owner, consultant, contractor, subcontractor |
| Subcontractor payments (`sub_pay_app`) | M6 (view/submit) | approve | · | edit | view | view | · | · | · | approve | owner, consultant, contractor, subcontractor |
| NCR (`ncr`) | M4 | approve | edit | view | view | view | view | edit | approve | view | — |
| Safety (`safety`) | M4 | approve | view | view | view | view | view | edit | approve | view | — |
| Change Order (`change_order`) | M6 (view) | approve | view | edit | view | · | · | · | · | view | owner, consultant, contractor |
| EOT (`eot`) | web only | approve | edit | edit | view | · | · | · | · | view | owner, consultant, contractor |
| Meetings (`meeting`) | M2 (view) | approve | approve | edit | edit | edit | edit | edit | edit | edit | owner, consultant, contractor, subcontractor |
| Tasks (`task`) | M2 | approve | approve | edit | edit | edit | edit | edit | edit | edit | owner, consultant, contractor, subcontractor |
| Locations (`location`) | M2 (pick) | edit | edit | view | view | view | view | edit | edit | view | owner, consultant, contractor, subcontractor |
| Inspections & Forms (`inspection`) | M4 | approve | approve | edit | view | view | view | edit | approve | view | owner, consultant, contractor, subcontractor |
| Punch List (`punch`) | M4 | approve | edit | edit | view | view | view | edit | approve | view | owner, consultant, contractor, subcontractor |
| Timesheets (`timesheet`) | M3 | approve | edit | view | approve | view | view | edit | edit | view | owner, consultant, contractor, subcontractor |
| Change Events (`change_event`) | M6 | approve | edit | approve | view | edit | · | edit | edit | view | owner, consultant, contractor |
| Lookahead (`lookahead`) | M3 | edit | edit | view | view | view | view | edit | edit | view | owner, consultant, contractor, subcontractor |
| Messages (`conversation`) | M1 (view) | edit | edit | edit | edit | edit | edit | edit | edit | edit | owner, consultant, contractor, subcontractor |
| BIM (`bim`) | web only | edit | edit | edit | view | view | view | edit | edit | view | owner, consultant, contractor, subcontractor |
| Project Emails (`email`) | web only | edit | edit | edit | edit | view | · | edit | edit | view | contractor |

Levels: **approve** = holds approve or certify; **edit** = create, update or submit; **view** = read only; · = no access.

## Per module

### Schedule (`schedule`) — mobile: M3

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | · | · | · | · | · | · | · |
| update | ✓ | ✓ | · | · | · | · | · | · | · |
| delete | ✓ | ✓ | · | · | · | · | · | · | · |
| submit | ✓ | ✓ | · | · | · | · | · | · | · |
| approve | ✓ | · | · | · | · | · | · | · | · |
| baseline | ✓ | · | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · |

Transitions: `revision.activate` → PM; `revision.rollback` → PM; `revision.submit_review` → PM, Plan; `revision.approve` → PM; `revision.reject` → PM; `revision.baseline` → PM.

Parties: **owner** read/export; **consultant** read/export; **contractor** read/export; **subcontractor** read.

### Progress (`progress`) — mobile: M3

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| update | ✓ | ✓ | · | · | · | · | · | · | · |
| submit | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| approve | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · |

Transitions: `submission.submit` → PM, Plan, Site, Qual; `submission.approve` → PM, Plan, QS; `submission.reject` → PM, Plan, QS; `method.configure` → PM, Plan; `daily_report.update` → PM, Plan, Site, Qual; `daily_report.submit` → PM, Plan, Site, Qual; `daily_report.approve` → PM; `daily_report.reject` → PM; `daily_report.review` → PM; `site_diary.update` → PM, Plan, Site, Qual; `site_diary.submit` → PM, Plan, Site, Qual; `site_diary.approve` → PM; `site_diary.reject` → PM; `site_reporting.upload` → PM, Plan, Site, Qual; `daily_log.update` → PM, Plan, Site, Qual; `daily_log.submit` → PM, Plan, Site, Qual; `daily_log.entry_review` → PM, Plan, Site, Qual; `daily_log.approve` → PM; `daily_log.distribute` → PM, Plan, Site, Qual; `daily_log.configure` → PM.

Parties: **owner** read/export; **consultant** read; **contractor** read/create/submit (submission.submit, daily_report.submit, site_reporting.upload, daily_log.submit); **subcontractor** read/create/submit (submission.submit, daily_report.submit, site_reporting.upload, daily_log.submit).

### BOQ (`boq`) — mobile: web only

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| update | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| submit | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| approve | ✓ | · | ✓ | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · |

Transitions: `allocation.create` → PM, Plan, QS; `allocation.update` → PM, Plan, QS; `allocation.submit` → PM, Plan, QS; `allocation.approve` → PM, QS; `allocation.reject` → PM, QS.

Parties: **owner** read/export; **consultant** read; **contractor** read; **subcontractor** read.

### IPC (`ipc`) — mobile: web only

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | · | ✓ | ✓ | · | · | · | · | ✓ |
| create | ✓ | · | ✓ | · | · | · | · | · | · |
| update | ✓ | · | ✓ | · | · | · | · | · | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| submit | ✓ | · | ✓ | · | · | · | · | · | · |
| approve | ✓ | · | · | · | · | · | · | · | ✓ |
| certify | ✓ | · | · | · | · | · | · | · | ✓ |
| export | ✓ | · | ✓ | ✓ | · | · | · | · | ✓ |

Transitions: `period.create` → PM, QS; `period.submit` → PM, QS; `period.certify` → PM, Fin; `item.update` → PM, QS; `invoice.issue` → PM, Fin; `payment.record` → Fin; `retention.release` → Fin; `contract.manage` → PM, QS; `advance.record` → PM, Fin.

Parties: **owner** read/export.

### Cost Control (`cost`) — mobile: web only

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | · | · | · | · | ✓ |
| create | ✓ | · | ✓ | ✓ | · | · | · | · | · |
| update | ✓ | · | ✓ | ✓ | · | · | · | · | · |
| delete | ✓ | · | · | ✓ | · | · | · | · | · |
| submit | ✓ | · | ✓ | ✓ | · | · | · | · | · |
| approve | ✓ | · | · | · | · | · | · | · | ✓ |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | · | ✓ |

Transitions: `reporting_period.lock` → PM, Fin; `reporting_period.override` → PM; `burn_rate.create` → PM, QS, Cost; `activity_cost.upsert` → PM, QS, Cost; `activity_cost.update` → PM, QS, Cost; `direct_cost.submit` → PM, QS, Cost; `direct_cost.approve` → PM, Fin; `direct_cost.pay` → PM, Fin; `direct_cost.void` → PM, Fin.

Parties: **owner** read/export.

### Procurement (`procurement`) — mobile: M5/M6

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | · | · | ✓ | · | · | · | · |
| update | ✓ | ✓ | · | · | ✓ | · | · | · | · |
| delete | ✓ | ✓ | · | · | · | · | · | · | · |
| submit | ✓ | · | · | · | ✓ | ✓ | ✓ | ✓ | · |
| approve | ✓ | · | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ |

Transitions: `supplier.manage` → PM, Proc; `package.manage` → PM, Plan, Proc; `po.issue` → PM, Proc; `po.submit` → PM, Proc, Plan; `po.approve` → PM; `po.acknowledge` → PM, Proc; `po.cancel` → PM, Proc; `po.close` → PM, Proc; `receipt.post` → PM, Proc, Store; `material.plan` → PM, Plan, Proc; `material.use` → PM, Store, Site, Qual; `alert.acknowledge` → PM, Plan, Proc, Store; `alert.resolve` → PM, Plan, Proc, Store.

Parties: **owner** read/export; **contractor** read.

### Inventory & Warehouse (`inventory`) — mobile: M5

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | · | · | · | ✓ | ✓ | · | · | · |
| update | ✓ | · | · | · | ✓ | ✓ | · | · | · |
| delete | ✓ | · | · | · | · | ✓ | · | · | · |
| submit | ✓ | · | · | · | · | ✓ | ✓ | ✓ | · |
| approve | ✓ | · | · | · | · | ✓ | · | · | · |
| export | ✓ | · | ✓ | ✓ | ✓ | ✓ | · | · | ✓ |

Transitions: `item.manage` → PM, Proc, Store; `warehouse.manage` → PM, Store; `stock.receive` → PM, Proc, Store; `stock.issue` → PM, Store, Site, Qual; `stock.return` → PM, Store, Site, Qual; `stock.transfer` → PM, Store; `stock.adjust` → PM, Store; `stock.count` → PM, Store.

### Risk Register (`risk`) — mobile: M3 (view)

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| update | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| delete | ✓ | ✓ | · | · | · | · | · | · | · |
| submit | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| approve | ✓ | · | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · |

Transitions: `risk.submit` → PM, Plan, QS; `risk.approve` → PM; `risk.reject` → PM; `risk.reopen` → PM.

Parties: **owner** read/export; **consultant** read; **contractor** read.

### User Management (`user_management`) — mobile: web only

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| create | ✓ | · | · | · | · | · | · | · | · |
| update | ✓ | · | · | · | · | · | · | · | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| submit | ✓ | · | · | · | · | · | · | · | · |
| approve | ✓ | · | · | · | · | · | · | · | · |
| export | ✓ | · | · | · | · | · | · | · | · |

Transitions: `user.invite` → PM; `user.activate` → PM; `user.deactivate` → PM; `user.send_password_reset` → PM; `user.assign_role` → PM.

`user.send_password_reset` replaced `user.reset_password` in D-ID-1 (2026-10-05): an administrator can only ask OctaPM to send the person the self-service reset e-mail (`POST /users/:id/password-reset-email`, `update` + this transition); nobody sets another person's password. Adding a person is always an invitation (`POST /users/invitations`, `submit` + `user.invite`; `POST /users` is a deprecated alias); listing, revoking and resending pending invitations use the same gate. Company administrators pass the `user_management` module gate whatever their role. See the [API map §1.6](OCTAPM_MOBILE_API_MAP.md).

### Project Parties (`project_parties`) — mobile: web only

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | · | · | · | · | · | · | · |
| update | ✓ | ✓ | · | · | · | · | · | · | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| submit | ✓ | ✓ | · | · | · | · | · | · | · |
| approve | ✓ | · | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | · | · | · | · | · | · |

Transitions: `party.assign` → PM, Plan; `party.update` → PM, Plan; `party.remove` → PM; `party.member.add` → PM, Plan; `party.member.remove` → PM.

Parties: **owner** read; **consultant** read; **contractor** read; **subcontractor** read.

### Reports (`report`) — mobile: web only

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ |
| update | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ |
| delete | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ |
| export | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Transitions: `report.schedule` → PM, Plan, QS, Cost, Proc, Fin; `report.share` → PM, Plan, QS, Cost, Proc, Fin.

Parties: **owner** read/export; **consultant** read/export; **contractor** read/create/update/export; **subcontractor** read/create/update/export.

### Workflows (`workflow`) — mobile: M6

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | · | · | · | · | · | · | · | · |
| update | ✓ | · | · | · | · | · | · | · | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| submit | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| approve | ✓ | · | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | · | ✓ |

Transitions: `workflow.respond` → PM, Plan, QS, Cost, Proc, Store, Site, Fin, Qual; `workflow.manage` → PM.

Parties: **owner** read/submit (workflow.respond); **consultant** read/submit (workflow.respond); **contractor** read/submit (workflow.respond); **subcontractor** read/submit (workflow.respond).

### Custom fields (`custom_field`) — mobile: M2

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | · | · | · | · | · | · | · | · |
| update | ✓ | · | · | · | · | · | · | · | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Transitions: `custom_field.manage` → PM.

Parties: **owner** read; **consultant** read; **contractor** read; **subcontractor** read.

### Assistant (`assistant`) — mobile: later

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Parties: **owner** read; **consultant** read; **contractor** read; **subcontractor** read.

### Bid Management (`bid`) — mobile: web only

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ |
| create | ✓ | · | ✓ | · | ✓ | · | · | · | · |
| update | ✓ | · | ✓ | · | ✓ | · | · | · | · |
| delete | ✓ | · | · | · | ✓ | · | · | · | · |
| submit | ✓ | · | ✓ | · | ✓ | · | · | · | · |
| approve | ✓ | · | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ |

Transitions: `bid.publish` → PM, Proc; `bid.answer` → PM, QS, Proc; `bid.award` → PM.

### Portfolio (`portfolio`) — mobile: web only

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ |
| export | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ |

### Audit History (`audit`) — mobile: M2 (history)

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | · | ✓ |

Parties: **owner** read; **consultant** read; **contractor** read; **subcontractor** read.

### Document Control (`document_control`) — mobile: M2

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| update | ✓ | ✓ | · | · | · | · | · | · | · |
| submit | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| approve | ✓ | · | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · |

Transitions: `document.revision.upload` → PM, Plan, Site, Qual; `document.revision.submit_review` → PM, Plan, Site, Qual; `document.revision.approve` → PM; `document.revision.supersede` → PM; `drawing.publish` → PM, Plan.

Parties: **owner** read/export; **consultant** read/create/submit (document.revision.upload, document.revision.submit_review); **contractor** read/create/submit (document.revision.upload, document.revision.submit_review); **subcontractor** read/create/submit (document.revision.upload, document.revision.submit_review).

### RFI (`rfi`) — mobile: M2

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| update | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| submit | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| approve | ✓ | · | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · |

Transitions: `rfi.submit` → PM, Plan, Site, Qual; `rfi.answer` → PM, Plan, Site, Qual; `rfi.close` → PM; `rfi.reopen` → PM; `rfi.approve` → PM; `rfi.reject` → PM.

Parties: **owner** read/submit (rfi.answer); **consultant** read/submit (rfi.answer); **contractor** read/create/update/submit (rfi.submit); **subcontractor** read/create/update/submit (rfi.submit).

### Submittal (`submittal`) — mobile: M2

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| update | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| submit | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| approve | ✓ | · | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · |

Transitions: `submittal.submit` → PM, Plan, Site, Qual; `submittal.review` → PM, Plan, QS; `submittal.resubmit` → PM, Plan, Site, Qual; `submittal.approve` → PM; `submittal.reject` → PM.

Parties: **owner** read; **consultant** read/submit/approve (submittal.review, submittal.approve, submittal.reject); **contractor** read/create/update/submit (submittal.submit, submittal.resubmit); **subcontractor** read/create/update/submit (submittal.submit, submittal.resubmit).

### Commitments (`commitment`) — mobile: M6 (view)

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ |
| create | ✓ | · | ✓ | · | ✓ | · | · | · | · |
| update | ✓ | · | ✓ | · | ✓ | · | · | · | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| submit | ✓ | · | ✓ | · | ✓ | · | · | · | · |
| approve | ✓ | · | · | · | · | · | · | · | ✓ |
| export | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ |

Transitions: `commitment.submit` → PM, QS, Proc; `commitment.approve` → PM; `commitment.execute` → PM, Fin; `commitment.close` → PM, Fin; `commitment.void` → PM; `commitment_co.submit` → PM, QS, Proc; `commitment_co.approve` → PM; `scope.manage` → PM, QS, Proc; `scope.agree` → PM, QS; `closeout.manage` → PM, QS, Site, Qual; `closeout.approve` → PM, QS; `evaluation.manage` → PM, QS, Site, Qual; `evaluation.approve` → PM, QS.

Parties: **owner** read; **consultant** read; **contractor** read/create/update/submit/export (commitment.submit, commitment_co.submit); **subcontractor** read/export.

### Subcontractor payments (`sub_pay_app`) — mobile: M6 (view/submit)

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | · | ✓ | ✓ | ✓ | · | · | · | ✓ |
| create | ✓ | · | ✓ | · | · | · | · | · | · |
| update | ✓ | · | ✓ | · | · | · | · | · | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| submit | ✓ | · | ✓ | · | · | · | · | · | · |
| approve | ✓ | · | · | · | · | · | · | · | · |
| certify | ✓ | · | · | · | · | · | · | · | ✓ |
| export | ✓ | · | ✓ | ✓ | · | · | · | · | ✓ |

Transitions: `sub_pay_app.submit` → PM, QS; `sub_pay_app.review` → PM, QS; `sub_pay_app.approve` → PM; `sub_pay_app.reject` → PM, QS; `sub_pay_app.pay` → PM, Fin; `sub_pay_app.void` → PM; `sub_pay_app.accounting_sync` → PM, Fin.

Parties: **owner** read; **consultant** read; **contractor** read/create/update/submit/export (sub_pay_app.submit); **subcontractor** read/create/update/submit/export (sub_pay_app.submit).

### NCR (`ncr`) — mobile: M4

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| update | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| submit | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| approve | ✓ | · | · | · | · | · | · | ✓ | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | · |

Transitions: `ncr.submit` → PM, Plan, Site, Qual; `ncr.close` → PM, Plan, Site, Qual; `ncr.approve` → PM, Qual; `ncr.reject` → PM, Qual; `ncr.reopen` → PM, Qual.

### Safety (`safety`) — mobile: M4

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | · | · | · | · | · | ✓ | ✓ | · |
| update | ✓ | · | · | · | · | · | ✓ | ✓ | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| submit | ✓ | · | · | · | · | · | ✓ | ✓ | · |
| approve | ✓ | · | · | · | · | · | · | ✓ | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | · |

Transitions: `safety.submit` → PM, Site, Qual; `safety.close` → PM, Site, Qual; `safety.approve` → PM, Qual; `safety.reject` → PM, Qual; `safety.reopen` → PM, Qual.

### Change Order (`change_order`) — mobile: M6 (view)

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | · | · | · | · | ✓ |
| create | ✓ | · | ✓ | · | · | · | · | · | · |
| update | ✓ | · | ✓ | · | · | · | · | · | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| submit | ✓ | · | ✓ | · | · | · | · | · | · |
| approve | ✓ | · | · | · | · | · | · | · | · |
| export | ✓ | · | ✓ | ✓ | · | · | · | · | ✓ |

Transitions: `change_order.submit` → PM, QS; `change_order.approve` → PM; `change_order.reject` → PM; `change_order.reopen` → PM, QS.

Parties: **owner** read/export; **consultant** read; **contractor** read.

### EOT (`eot`) — mobile: web only

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | · | · | · | · | ✓ |
| create | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| update | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| submit | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| approve | ✓ | · | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | · | ✓ |

Transitions: `eot.submit` → PM, Plan, QS; `eot.approve` → PM; `eot.reject` → PM.

Parties: **owner** read/export; **consultant** read; **contractor** read.

### Meetings (`meeting`) — mobile: M2 (view)

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| update | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| delete | ✓ | ✓ | · | · | · | · | · | · | · |
| submit | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| approve | ✓ | ✓ | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · |

Transitions: `meeting.distribute` → PM, Plan; `meeting.comment` → PM, Plan, QS, Cost, Proc, Store, Site, Fin, Qual.

Parties: **owner** read/submit (meeting.comment); **consultant** read/create/update/submit (meeting.comment, meeting.distribute); **contractor** read/create/update/submit (meeting.comment); **subcontractor** read/submit (meeting.comment).

### Tasks (`task`) — mobile: M2

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| update | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| delete | ✓ | ✓ | · | · | · | · | · | · | · |
| submit | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| approve | ✓ | ✓ | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · |

Transitions: `task.assign` → PM, Plan, Site, Qual; `task.comment` → PM, Plan, QS, Cost, Proc, Store, Site, Fin, Qual; `task.close` → PM, Plan, Site, Qual.

Parties: **owner** read/submit (task.comment); **consultant** read/submit (task.comment); **contractor** read/create/update/submit (task.assign, task.comment, task.close); **subcontractor** read/create/update/submit (task.assign, task.comment, task.close).

### Locations (`location`) — mobile: M2 (pick)

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| update | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| delete | ✓ | ✓ | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | · |

Transitions: `location.archive` → PM, Plan; `location.restore` → PM, Plan.

Parties: **owner** read; **consultant** read; **contractor** read; **subcontractor** read.

### Inspections & Forms (`inspection`) — mobile: M4

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · |
| update | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · |
| delete | ✓ | ✓ | · | · | · | · | · | · | · |
| submit | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · |
| approve | ✓ | ✓ | · | · | · | · | · | ✓ | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | · |

Transitions: `inspection.start` → PM, Plan, Site, QS, Qual; `inspection.complete` → PM, Plan, Site, QS, Qual; `inspection.sign` → PM, Plan, Site, QS, Qual; `inspection.close` → PM, Plan, Qual; `inspection.reopen` → PM, Plan, Qual; `inspection.void` → PM, Qual; `inspection.template_admin` → PM, Plan, QS, Qual.

Parties: **owner** read/export; **consultant** read/create/submit/approve/export (inspection.start, inspection.complete, inspection.sign, inspection.close, inspection.reopen); **contractor** read/create/update/submit/export (inspection.start, inspection.complete, inspection.sign, inspection.template_admin); **subcontractor** read/submit/export (inspection.start, inspection.complete, inspection.sign).

### Punch List (`punch`) — mobile: M4

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · |
| update | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| submit | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| approve | ✓ | · | · | · | · | · | · | ✓ | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | · |

Transitions: `punch.open` → PM, Plan, Site, Qual; `punch.ready_for_review` → PM, Plan, Site, Qual; `punch.close` → PM, Qual; `punch.reopen` → PM, Plan, Site, Qual; `punch.dispute` → PM, Plan, Site, Qual; `punch.void` → PM, Qual; `punch.distribute` → PM, Plan, Site, Qual.

Parties: **owner** read/export; **consultant** read/create/submit/approve/export (punch.open, punch.close, punch.reopen); **contractor** read/create/update/submit/export (punch.open, punch.ready_for_review, punch.dispute, punch.distribute); **subcontractor** read/update/submit/export (punch.ready_for_review, punch.dispute).

### Timesheets (`timesheet`) — mobile: M3

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| update | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| delete | ✓ | · | · | · | · | · | ✓ | ✓ | · |
| submit | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| approve | ✓ | · | · | ✓ | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | ✓ |

Transitions: `timesheet.submit` → PM, Plan, Site, Qual; `timesheet.approve` → PM, Cost; `timesheet.reject` → PM, Cost; `timesheet.reopen` → PM, Cost; `timesheet.worker_admin` → PM, Site, Cost, Qual.

Parties: **owner** read/export; **consultant** read/export; **contractor** read/create/update/delete/submit/export (timesheet.submit, timesheet.worker_admin); **subcontractor** read/create/update/delete/submit/export (timesheet.submit, timesheet.worker_admin).

### Change Events (`change_event`) — mobile: M6

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · |
| update | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| delete | ✓ | · | ✓ | · | · | · | · | · | · |
| submit | ✓ | · | ✓ | · | ✓ | · | · | · | · |
| approve | ✓ | · | ✓ | · | · | · | · | · | · |
| export | ✓ | · | ✓ | ✓ | ✓ | · | · | · | ✓ |

Transitions: `change_event.rfq_send` → PM, QS, Proc; `change_event.quote_accept` → PM, QS; `change_event.convert` → PM, QS; `change_event.close` → PM, QS; `change_event.void` → PM.

Parties: **owner** read/export; **consultant** read; **contractor** read/create/update/submit/export (change_event.rfq_send).

### Lookahead (`lookahead`) — mobile: M3

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| update | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| delete | ✓ | ✓ | · | · | · | · | · | · | · |
| submit | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · |
| export | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | · |

Transitions: `lookahead.publish` → PM, Plan, Site, Qual; `lookahead.archive` → PM, Plan; `lookahead.item_status` → PM, Plan, Site, Qual.

Parties: **owner** read/export; **consultant** read/export; **contractor** read/create/update/delete/submit/export (lookahead.publish, lookahead.archive, lookahead.item_status); **subcontractor** read/update/export (lookahead.item_status).

### Messages (`conversation`) — mobile: M1 (view)

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| update | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| delete | ✓ | · | · | · | · | · | · | · | · |

Parties: **owner** read/create/update; **consultant** read/create/update; **contractor** read/create/update; **subcontractor** read/create/update.

### BIM (`bim`) — mobile: web only

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | · | · | · | · | · | · | · |
| update | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · |

Transitions: `bim.link` → PM, Plan, QS, Site, Qual.

Parties: **owner** read/export; **consultant** read/export; **contractor** read/update/export (bim.link); **subcontractor** read.

### Project Emails (`email`) — mobile: web only

| Action | PM | Plan | QS | Cost | Proc | Store | Site | Qual | Fin |
|---|---|---|---|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ |
| create | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · |
| update | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | · |
| delete | ✓ | · | · | · | · | · | · | · | · |
| export | ✓ | ✓ | ✓ | · | · | · | · | · | · |

Transitions: `email.settings` → PM.

Parties: **contractor** read/update.

## What the app never does, whatever the matrix says

- Approve, certify, record payments, transfer budget, activate or baseline schedule revisions, or post cost from a phone: these stay on the web platform even for roles that hold them, and the app hands over with a link.
- Set a status by editing a record. Every state change goes through the transition endpoint the API map lists, so the server applies its workflow rules.
- Compute a permission from a role name. The rendered matrix comes from the server for the current project.
