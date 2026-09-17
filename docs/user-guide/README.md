# OctaPM User Guide and Role Handbook

The official handbook for people who use OctaPM to run construction projects. It describes the
product as it is today, validated in the browser as each role, on clean demonstration data.

The Markdown under this folder is the single source. The client documentation and the training kit
are built from it into `deliverables/`, as PDF, Word and one workbook; see the
[Publishing Map](OCTAPM_PUBLISHING_MAP.md) for what becomes what. Do not edit anything under
`deliverables/`: the next build overwrites it.

```
npm install --prefix tools/publishing
node tools/publishing/build.mjs
```

## Start here

- [Quick Start](OCTAPM_QUICK_START.md) — ten minutes: sign in, workspace, project, Needs You, quick actions, modules, search, notifications, help.
- [User Guide](OCTAPM_USER_GUIDE.md) — the master guide, thirty chapters from signing in to support.

## Reference

- [Role Feature Matrix](OCTAPM_ROLE_FEATURE_MATRIX.md) — what every role can create, edit, approve, close, view; taken from the permission rules the product enforces.
- [Workflow Guide](OCTAPM_WORKFLOW_GUIDE.md) — the connected workflows: who starts, who receives, what changes, who approves, the final state.
- [Responsibility Guide](OCTAPM_RESPONSIBILITY_GUIDE.md) — Needs You, ball in court, owner, assignee, reviewer, approver, responsible company, and how responsibility moves.
- [Glossary](OCTAPM_GLOSSARY.md) — construction and OctaPM terms in plain language.

## Role guides

| Role | Guide |
| --- | --- |
| Company / Admin | [roles/ADMIN_GUIDE.md](roles/ADMIN_GUIDE.md) |
| Project Manager | [roles/PROJECT_MANAGER_GUIDE.md](roles/PROJECT_MANAGER_GUIDE.md) |
| Planner | [roles/PLANNER_GUIDE.md](roles/PLANNER_GUIDE.md) |
| QS / Commercial | [roles/QS_COMMERCIAL_GUIDE.md](roles/QS_COMMERCIAL_GUIDE.md) |
| Cost Controller | [roles/COST_CONTROLLER_GUIDE.md](roles/COST_CONTROLLER_GUIDE.md) |
| Procurement | [roles/PROCUREMENT_GUIDE.md](roles/PROCUREMENT_GUIDE.md) |
| Storekeeper / Warehouse | [roles/STOREKEEPER_GUIDE.md](roles/STOREKEEPER_GUIDE.md) |
| Site Engineer | [roles/SITE_ENGINEER_GUIDE.md](roles/SITE_ENGINEER_GUIDE.md) |
| Quality Engineer | [roles/QUALITY_ENGINEER_GUIDE.md](roles/QUALITY_ENGINEER_GUIDE.md) |
| Finance | [roles/FINANCE_GUIDE.md](roles/FINANCE_GUIDE.md) |
| Supplier / Bidder | [roles/SUPPLIER_BIDDER_GUIDE.md](roles/SUPPLIER_BIDDER_GUIDE.md) |

Client / Owner and Subcontractor logins are not supported in this release; the User Guide, chapter
11, says what is and is not available to them.

## Training and UAT

- [Training and UAT Workbook](training/OCTAPM_TRAINING_UAT_WORKBOOK.md) — four levels, ten connected team scenarios, ten independent ones, observation sheets, pass criteria.
- [Participant Pack](training/OCTAPM_UAT_PARTICIPANT_PACK.md) — what a participant is given. No answers in it.
- [Trainer Guide](training/OCTAPM_TRAINER_GUIDE.md) — how to run the day and what to withhold.
- [UAT Defect Register](../uat/OCTAPM_UAT_DEFECT_REGISTER.md) — where findings from a session go.

## About this handbook

- [Publishing Map](OCTAPM_PUBLISHING_MAP.md) — which source becomes which deliverable, and what the build does on the way.
- [Coverage Matrix](OCTAPM_GUIDE_COVERAGE_MATRIX.md) — every product feature against the guide, role guides, workflow guide and screenshots.
- [Guide Report](OCTAPM_USER_GUIDE_REPORT.md) — what was documented, validated, captured, and what is missing.
- [Product Findings](OCTAPM_GUIDE_PRODUCT_FINDINGS.md) — product behaviour and issues found while documenting, classified; nothing was changed in the product during this work.
- [Findings Disposition](OCTAPM_GUIDE_FINDINGS_DISPOSITION.md) — what each finding means for client training and for the pilot.
- [Package Report](OCTAPM_CLIENT_DOCUMENTATION_PACKAGE_REPORT.md) — how the client package and training kit were produced and checked.

Version: written against the product on branch `feat/p0-foundations-sprint1` at commit `0fce677`
(15 September 2026). Published as version 1.0, Pilot Edition, September 2026.
