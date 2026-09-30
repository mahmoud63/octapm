# Round 5 checkpoint review — owner decisions (2026-09-30)

**Status:** Round 5 (PC-5, PC-7a, PC-8, QA hygiene) accepted as an implementation checkpoint at `a2f677f`
on `feat/p0-foundations-sprint1`. Round 5 is not reopened. These decisions are authoritative for the
bounded follow-up, PC-6 and PC-7b.

## R5-1 Approved change-order schedule impacts in the forecast

- The forecast counts explicitly approved schedule impacts (`ChangeOrderActivityLink.approvedScheduleImpactDays`
  on an approved, unarchived change order). They are not suppressed to preserve earlier forecast dates.
- Baseline dates, contractual completion dates, financial amounts and approved records are never changed
  automatically by this.
- The output is a **forecast**, never an approved extension of time, and is labelled so.
- The census (`OCTAPM_FORECAST_CHANGE_IMPACTS_CENSUS.md`) shows the calculation's effect; it does not by
  itself prove the certified project's 45-day net delay. Before that projection is treated as validated, a
  narrow trace and regression case explain: why the six ten-day impacts on Blockwork are additive; whether
  impacts overlap or are already reflected in the current schedule; how activity impacts produce 45 days at
  project level; and the engine's calendar/day convention. No new delay-analysis engine. If the existing
  calculation cannot support the conclusion, the limitation and the smallest proposed correction are
  reported.
- The census method is kept in the repository as a reproducible, read-only command (not only in C:\Temp).

## R5-2 Default cost forecast

- `max(budget, actual)` is approved as the **initial default when the forecast is genuinely missing**.
- Its basis is labelled honestly (a default is never presented as an entered forecast, and vice versa).
- A supplied or user-maintained forecast is never overwritten by an unrelated edit, and a valid supplied value
  is never treated as missing because it is falsy (0 is a forecast).
- The default stays separate from the established BAC ÷ CPI EAC calculation.

## R5-3 Commitment label

- The BOQ item's base-only figure is named **"Base commitment value (excluding approved variations)"**.
- Canonical total-commitment calculations are not changed to match this partial figure.

## R5-4 Setup headline

- The headline distinguishes **no schedule**, **imported/staged schedule** and **active schedule**. An import
  can truthfully be complete before activation.
- "Critical unmapped 0" is never shown when no eligible schedule has been assessed; "Waiting for active
  schedule" (or the appropriate unavailable state) is shown instead.
- BOQ-derived-information restrictions are preserved.

## R5-5 Change-order related records (PC-7b task)

- The missing reverse links (change order → BOQ item / activity) are an explicit PC-7b task.
- Authorized direct or allocation-derived activity relationships are shown accurately; "No activity" is never
  shown when an authorized indirect relationship exists.
- No duplicate relationships are created and no restricted BOQ data is revealed.

## R5-6 CI checks

- The approved frontend source-check registry runs in CI.
- Truly static checks are separated from anything needing a database, browser or fixture reset; the latter use
  isolated test resources.
- Real exit codes and logs are preserved. Deployment is not enabled and production protection settings are not
  modified.

## Bounded follow-up (before PC-6)

Decisions R5-2, R5-3, R5-4 and R5-6 are implemented with targeted tests and coherent commits; R5-1 gets the
narrow trace and regression case only; R5-5 belongs to PC-7b. Two browser checks are added: the budget
dialog's protection/reactivation messages, and the IPC "Open Contract terms" link. The full web suite stays
with the integrated certification unless a confirmed regression requires it sooner.

## Next implementation

After the follow-up checkpoint: **PC-6**, then **PC-7b**, then one combined implementation checkpoint and a
STOP before final CERT.

- **PC-6** keeps received, issued, installed, certified and paid quantities separate, and prevents a
  submit-only user from importing approved progress (import by a user without approval authority creates
  pending progress).
- **PC-7b** provides reviewed exceptions and a Change Event handoff — never automatic Change Orders and never
  automatic budget or schedule changes. It includes R5-5.

## Questions raised by the follow-up reviews (awaiting the owner; nothing changed)

- **R5-1, the certified project's 45 days.** The trace (OCTAPM_FORECAST_CHANGE_IMPACTS_CENSUS.md §5) shows
  the figure is not supportable as evidence of delay: VO-10…VO-20 are one client instruction recorded six
  times by the Phase-21 certification harness (stage 8, before its re-run guard existed); the engine adds an
  impact to the activity's own finish without moving successors (45 = 60 − 15); working days are added as
  calendar days; there is no overlap or "already in the schedule" handling. Two of the duplicates (VO-18,
  VO-20) each posted 125,000 of approved budget change that the certified snapshot expects and reconciles, so
  correcting the duplicates would move certified figures. Proposals P1–P4 in §5.6 are proposals only.
- **R5-2, what a default-source cost record displays.** The projection counts the live `max(budget, actual)`
  for a default row, while the row shows the default stored when it was set; after a schedule import every
  seeded row reads "Default forecast $0" beside a real Budget. Options: (a) read a default row as the live
  default (the stored figure becomes a placeholder), or (b) keep the frozen stored default with its labelled
  divergence. No stored amount of an existing project changes either way (all 271 existing rows are
  NULL-source).
- **R5-2, legacy rows.** A NULL-source forecast may be a pre-R5-2 default built from the allocation and stays
  visible to a member without BOQ read, because its source is unknowable and backfilling is forbidden.
  Recommended: the documented limit stands.
- **One toast per refused mutation.** Fixed for the three mutations named (budget line create/update, IPC
  certify); up to 310 other catch-and-toast callers still show a refusal twice. Follow-up, or invert the
  default so the global toast applies only to mutations that opt in?
- **Activity delete.** `DELETE /activities/:id` now refuses (409 `ACTIVITY_IN_USE`) an activity kept by a cost
  record, progress record or daily report — every activity of an activated revision. Should an approved BOQ
  allocation or a change-order link also keep an activity?
- **Two surfaces for one activity row.** The Activity ID cell opens the PC-5 controls drawer; any other cell
  still opens the older activity sheet. Both are proven to withhold BOQ data; whether to keep both is a UX
  choice.
- **Contract terms notice timing.** The IPC workbook's lasting notice appears after the first refused
  Certify, because the period read exposes nothing about the contract value's source and the contract read
  creates the contract row as a side effect. A pre-emptive notice needs a read-only "is the value
  established" flag on the period read (no amount) — say if wanted.

## Carried pre-release tasks

- Comment and conversation services: failure handling inside a caller's transaction (they still swallow an
  error marked `transactionAborted`).
- Notification service: its own `compactJson` has no Decimal branch (0 affected rows today); one-line
  hardening. Webhook redelivery of the 1,239 old-shape outbound payloads still sends them verbatim.
- Other web surfaces may still format date-only values through `new Date(value).toLocaleDateString()`
  (only the Forecast panel was fixed); the Schedule page footer prints raw ISO instants.
- `deploy.yml` triggers on push to main directly, not on a successful Quality Gates run, so the new
  source-check job does not gate a deploy; `validate-deployment-readiness.mjs` fails at the base
  (`APP_SECRETS_ARN`); the backend-tests CI job names a Postgres URL but declares no service container.
  All pre-existing; none changed (deployment settings are out of scope).
- Advance-receipt auditing (advance receipts are not audited; predates Round 5).
- The remaining documented coverage gaps: legacy `?module=` links without a Playwright proof; the staged
  revision's checks shown by link rather than inline; the cost module's missing per-record deep link; no
  backend ESLint configuration; four frontend files that already failed `prettier --check`.

## Out of scope until the owner says otherwise

AI API setup (deferred); the owner/Engineer portal, turnover system and marketplace; AWS provisioning, DNS
changes and production deployment; merging main.
