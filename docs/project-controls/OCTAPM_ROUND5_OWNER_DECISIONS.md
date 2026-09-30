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

## Carried pre-release tasks

- Comment and conversation services: failure handling inside a caller's transaction (they still swallow an
  error marked `transactionAborted`).
- Advance-receipt auditing (advance receipts are not audited; predates Round 5).
- The remaining documented coverage gaps: legacy `?module=` links without a Playwright proof; the staged
  revision's checks shown by link rather than inline; the cost module's missing per-record deep link; no
  backend ESLint configuration; four frontend files that already failed `prettier --check`.

## Out of scope until the owner says otherwise

AI API setup (deferred); the owner/Engineer portal, turnover system and marketplace; AWS provisioning, DNS
changes and production deployment; merging main.
