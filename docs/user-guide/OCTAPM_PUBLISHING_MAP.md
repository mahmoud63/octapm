# Publishing Map

Where each deliverable comes from. Nothing under `deliverables/` is written by hand: every page of
it is assembled from the Markdown in this directory by `tools/publishing`. If a sentence is wrong
in a PDF, the sentence is wrong here, and fixing it here fixes it everywhere.

## Source to output

| Canonical source | Goes into |
| --- | --- |
| `OCTAPM_USER_GUIDE.md` | Complete User Manual, chapters 1 to 30 |
| `OCTAPM_WORKFLOW_GUIDE.md` | Complete User Manual, Appendix A · Quick Start, the worked example |
| `OCTAPM_RESPONSIBILITY_GUIDE.md` | Complete User Manual, Appendix B |
| `OCTAPM_ROLE_FEATURE_MATRIX.md` | Complete User Manual, Appendix C · every role handbook, the permissions note |
| `OCTAPM_GLOSSARY.md` | Complete User Manual, Appendix D |
| `OCTAPM_QUICK_START.md` | Quick Start |
| `roles/ADMIN_GUIDE.md` | Administrator Handbook |
| `roles/PROJECT_MANAGER_GUIDE.md` | Project Manager Handbook |
| `roles/PLANNER_GUIDE.md` | Planner Handbook |
| `roles/QS_COMMERCIAL_GUIDE.md` | QS and Commercial Handbook |
| `roles/COST_CONTROLLER_GUIDE.md` | Cost Controller Handbook |
| `roles/PROCUREMENT_GUIDE.md` | Procurement Handbook |
| `roles/STOREKEEPER_GUIDE.md` | Storekeeper Handbook |
| `roles/SITE_ENGINEER_GUIDE.md` | Site Engineer Handbook |
| `roles/QUALITY_ENGINEER_GUIDE.md` | Quality Engineer Handbook |
| `roles/FINANCE_GUIDE.md` | Finance Handbook |
| `roles/SUPPLIER_BIDDER_GUIDE.md` | Supplier and Bidder Handbook |
| `training/OCTAPM_TRAINING_UAT_WORKBOOK.md` | Training and UAT Workbook |
| `training/OCTAPM_UAT_PARTICIPANT_PACK.md` | UAT Participant Pack |
| `training/OCTAPM_TRAINER_GUIDE.md` | Trainer Guide |
| `images/` | Every screenshot in every deliverable |

Two deliverables have no Markdown source because they are not prose. The training matrix is built
directly as a workbook by `tools/publishing/training-matrix.mjs`, and the delivery manifest lists
what was produced.

## Documents that stay in the repository

These are working records, not client material, and are not published:

| File | Why it stays here |
| --- | --- |
| `OCTAPM_GUIDE_COVERAGE_MATRIX.md` | Traceability from the feature register to the guide |
| `OCTAPM_GUIDE_PRODUCT_FINDINGS.md` | What was found while writing |
| `OCTAPM_GUIDE_FINDINGS_DISPOSITION.md` | What each finding means for training and the pilot |
| `OCTAPM_USER_GUIDE_REPORT.md` | How the documentation was produced and validated |
| `OCTAPM_CLIENT_DOCUMENTATION_PACKAGE_REPORT.md` | How this package was produced |
| `OCTAPM_PUBLISHING_MAP.md` | This file |
| `README.md` | The index for people working in the repository |
| `../uat/OCTAPM_UAT_DEFECT_REGISTER.md` | Filled in during sessions |

## What the publisher does on the way through

The build is not a straight conversion. Four things happen between the Markdown and the page, and
knowing them explains anything that looks different in a PDF.

- **Production notes are dropped.** Lines in the workflow guide that list the screen files
  evidencing a workflow are for this repository. A client reading a printed manual has no use for a
  list of file names.
- **Wide tables are split.** Anything past seven columns is broken into parts that each keep the
  first column, so the role and feature matrix stays readable on A4 rather than being shrunk until
  it is not.
- **Images become numbered figures.** The alt text becomes the caption. Two screenshots on
  consecutive lines are one Markdown paragraph, and each still becomes its own figure.
- **Contents pages are numbered from the printed file.** The build prints once, reads back the page
  each entry actually landed on, and prints again. If those numbers cannot be read back, the entries
  are published unnumbered rather than published wrong.

## Building

```
npm install --prefix tools/publishing
node tools/publishing/build.mjs
```

Or one set at a time: `manual`, `quick-start`, `role-handbooks`, `training`.

The toolchain keeps its own dependencies under `tools/publishing/node_modules` so that nothing in
the product's own build is touched by it.

## The rule

Do not edit anything under `deliverables/`. It is output. The next build overwrites it, and a
correction made there is lost without anybody noticing it has gone.
