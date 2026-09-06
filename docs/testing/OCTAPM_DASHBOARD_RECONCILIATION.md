# OctaPM dashboard reconciliation

Every KPI below was read off the rendered dashboard in a browser and then
recomputed independently from the underlying records. A number is only marked ✅
when the two agree.

## Workspace dashboard

| KPI | Displayed | Recomputed | Source cited on the card | Agrees |
| --- | ---: | ---: | --- | --- |
| Active Projects | 1 | 1 | `Project.status` | ✅ |
| Portfolio Health | 86 | not recomputed | Workspace project health dimensions | ❓ |
| Open Tasks | 0 | 0 (no task records) | Persisted Task records | ✅ |
| Critical Activities | 2 | 2 (`isCritical` on seeded activities) | `Activity.isCritical` | ✅ |
| Official Cost Actuals | 3 | 3 cost records | `CostRecord.actualThroughDate` | ✅ |
| Procurement Risks | 0 | 0 | Procurement orders, packages, PO lines, long-lead | ✅ |
| Overdue QA/Safety/Docs | 0 | 0 | NCR, RFI and Submittal records | ✅ |

Only `Active Projects` is asserted automatically, in
`03-financial-spine.spec.ts` › "workspace KPI counts match the records behind
them". The others were checked by hand against the seeded data during this pass
and agreed; they are not yet pinned by a test.

**Portfolio Health (86)** is a composite of weighted health dimensions. It was
not recomputed because reproducing the weighting independently would mean
reimplementing the algorithm, which proves nothing about correctness. It needs a
different technique: a fixture with known inputs and a hand-calculated expected
score.

## A genuine product strength

Each KPI card states its own provenance:

> **Active Projects** · Official · 1
> 1 visible projects
> Source: `Project.status`
> Cutoff: Sep 6, 2026

Naming the source table and the reporting cutoff on the card itself is unusual
and good. It makes a figure auditable by whoever is reading it, and it made this
reconciliation straightforward rather than archaeological. It also distinguishes
"Official" figures from provisional ones, which matters when a number is going
into a client report.

## Project health dashboard

`/projects/{id}/health` returns `overallScore`, `dimensions`, `dataFreshness`,
`kpiSourceRules` and `pendingReview`. It does **not** expose a plain overall
percent complete, so the obvious reconciliation — weighted progress from
approved `ActivityProgress` against what the dashboard shows — could not be done
like for like.

Recomputed independently from source records for the seeded project:

| Figure | Recomputed |
| --- | ---: |
| Weighted percent complete from approved progress | 41.85% |
| Total activity budget | 9,290,000 |
| Earned value | 3,887,940 |

The dashboard reports an `overallScore` of 86, which is a health index rather
than progress, so the two are not comparable. Exposing percent complete
alongside the health score would make the dashboard reconcilable and is worth
doing.

## Setup readiness panel

Not a KPI, but worth recording as verified: the project overview gates reporting
on real preconditions and explains each one — "No approved time-phased cost
loading rows are available for official EV", "5/10 complete, 4 blockers, 4
warnings", each with the gate it blocks (`baseline`, `progress`, `reporting`).
The blockers shown matched the seeded state exactly.

This is the right way to handle an incomplete project: refuse to publish
official figures and say precisely what is missing, rather than reporting
confidently from partial data.

## Still to reconcile

| KPI | Why not yet |
| --- | --- |
| Open RFIs | No test; needs RFI fixtures in known states |
| Pending Submittals | No submittal workflow coverage |
| Change Orders by status | Register verified, dashboard tile not |
| Budget variance | Needs the commitment and actual-cost chain first |
| Cost variance / CPI / SPI | Needs approved cost loading, currently a blocker |
| Open Punch Items | No punch workflow coverage |
| Safety items | No safety workflow coverage |
| Delays | No weather-delay coverage |

## Method note

Do not reconcile a dashboard by reimplementing its calculation — that only
proves two implementations agree. Where possible, count source rows directly
(as with Active Projects), or use a fixture whose expected answer was worked out
by hand.
