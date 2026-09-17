# OctaPM Delivery Manifest

Everything in this directory, what it is for, and where it came from. Version 1.0, Pilot Edition,
September 2026.

Nothing here is edited by hand. Each file is built from the Markdown under `docs/user-guide` by
`tools/publishing`. To change a sentence, change it at the source and build again; a correction
made in this directory is overwritten the next time anybody runs the build.

## Client documentation

| File | Purpose | Audience | Source | Pages |
| --- | --- | --- | --- | --- |
| `client/OCTAPM_COMPLETE_USER_MANUAL.pdf` / `.docx` | Every module, every role, the connected workflows, the permission matrix and the glossary | Anyone who needs the whole picture | `OCTAPM_USER_GUIDE.md` plus the workflow, responsibility, matrix and glossary guides | 53 |
| `client/OCTAPM_QUICK_START.pdf` / `.docx` | Ten minutes to a first productive session, ending with one workflow followed end to end | Everyone, on their first day | `OCTAPM_QUICK_START.md`, `OCTAPM_WORKFLOW_GUIDE.md` | 10 |

## Role handbooks

Each is written for one role: what they do, what they can reach, what they approve, who they hand
to, and what to check every day. Kept short enough to use while working.

| File | Role | Pages |
| --- | --- | --- |
| `client/role-handbooks/OCTAPM_ADMIN_HANDBOOK.pdf` / `.docx` | Company administrator | 10 |
| `client/role-handbooks/OCTAPM_PROJECT_MANAGER_HANDBOOK.pdf` / `.docx` | Project Manager | 11 |
| `client/role-handbooks/OCTAPM_PLANNER_HANDBOOK.pdf` / `.docx` | Planner | 9 |
| `client/role-handbooks/OCTAPM_QS_COMMERCIAL_HANDBOOK.pdf` / `.docx` | QS / Commercial | 10 |
| `client/role-handbooks/OCTAPM_COST_CONTROLLER_HANDBOOK.pdf` / `.docx` | Cost Controller | 9 |
| `client/role-handbooks/OCTAPM_PROCUREMENT_HANDBOOK.pdf` / `.docx` | Procurement | 10 |
| `client/role-handbooks/OCTAPM_STOREKEEPER_HANDBOOK.pdf` / `.docx` | Storekeeper / Warehouse | 10 |
| `client/role-handbooks/OCTAPM_SITE_ENGINEER_HANDBOOK.pdf` / `.docx` | Site Engineer | 11 |
| `client/role-handbooks/OCTAPM_QUALITY_ENGINEER_HANDBOOK.pdf` / `.docx` | Quality Engineer | 12 |
| `client/role-handbooks/OCTAPM_FINANCE_HANDBOOK.pdf` / `.docx` | Finance | 10 |
| `client/role-handbooks/OCTAPM_SUPPLIER_BIDDER_HANDBOOK.pdf` / `.docx` | Supplier / Bidder | 9 |

Each handbook is built from the matching guide in `docs/user-guide/roles/`.

## Training and UAT kit

| File | Purpose | Audience | Source | Pages |
| --- | --- | --- | --- | --- |
| `training/OCTAPM_TRAINING_UAT_WORKBOOK.pdf` / `.docx` | Four levels of exercises, ten connected team scenarios, ten independent ones, observation sheets and pass criteria | Trainers and participants | `training/OCTAPM_TRAINING_UAT_WORKBOOK.md` | 18 |
| `training/OCTAPM_UAT_PARTICIPANT_PACK.pdf` / `.docx` | Welcome, scope, rules, role sheet, scenario sheets, feedback form. No answers | Participants | `training/OCTAPM_UAT_PARTICIPANT_PACK.md` | 7 |
| `training/OCTAPM_TRAINER_GUIDE.pdf` / `.docx` | How to run the day, what to withhold, when to step in, how to tell a defect from a training gap | Trainers and observers only | `training/OCTAPM_TRAINER_GUIDE.md` | 7 |
| `training/OCTAPM_TRAINING_MATRIX.xlsx` | Participants, scenarios, certification and findings, as a workbook to fill in | Trainers | Built directly by `tools/publishing/training-matrix.mjs` | 4 sheets |

The matrix ships empty. Inventing participants would put made-up results in front of the people
deciding whether to run a pilot.

## What is not here

- **Nothing for a Client / Owner or a Subcontractor.** Neither has a login in this release, so
  neither has a handbook. Both are described in the manual as not supported rather than left out.
- **No answer keys for the independent exercises.** Level 4 measures whether the product explains
  itself. A crib sheet in the room would spend the only chance to find that out.

## Both formats

Every document is delivered as PDF and as Word.

The PDF is the one to print or send: it carries a heading outline for the reader's sidebar, a
contents page whose numbers were read back from the printed file rather than estimated, and running
page numbers.

The Word file is the one to edit if a client wants their own house version. It carries real heading
styles, a contents field that Word numbers itself, and the same headers and footers. Its contents
page asks to be refreshed on first open, which is Word's normal behaviour.

## Checks run before delivery

| Check | Result |
| --- | --- |
| PDFs with a page count, outline and working contents links | 16 of 16 |
| Word files whose XML parses, with headings, contents field, header and numbered footer | 16 of 16 |
| Broken internal links in the source | 0 |
| Missing images | 0 |
| Screenshots at a single consistent size | 110 of 110, every one 1440 by 900 pixels |
| Unsupported personas described as available | 0 |
| Product code changed in this phase | None |
