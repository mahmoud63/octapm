# Natural-language reporting (OCTA-AI-NLREPORT-033)

Two additions to the report builder (OCTA-RPT-BUILDER-023): **Ask for a
report** turns a question into a builder definition; **Explain these
numbers** turns a preview into a short summary. The assistant never saves a
report — the builder opens with the definition filled in and the person
checks and saves it.

## Ask for a report (`POST /reports/ask`)

1. The source catalogue (`listSources`: every source with its columns, types
   and enum values, default columns and sort) and the question go to the
   model with a strict prompt: use only catalogue keys, the operator set of
   the builder (`eq`, `neq`, `contains`, `in`, `nin`, `gt`… `between`,
   `empty`, `not_empty`, `is_true`, `is_false`, `last_days`, `next_days`,
   `before_today`, `after_today`, `today`), one source, grouping and
   aggregates only when asked, a chart only when asked or grouped.
2. The proposal is **repaired against the builder's own normaliser**:
   unknown columns are dropped, filters that cannot be applied are dropped,
   an unknown sort or group is ignored, rejected aggregates are dropped —
   each with a line in `warnings`. An unknown source falls back to the
   keyword reading.
3. The definition is **previewed as the caller** (50 rows; the same
   permission gates as the builder) and returned with `explanation`,
   `assumptions`, `warnings` and the preview.
4. Without a provider (or if the model returns nothing usable) the
   **keyword reading** picks the source (RFI, submittal, punch, observation,
   inspection, NCR, safety, change order, commitment, pay app, IPC, PO,
   long lead, budget line, cost, manpower, daily log, risk, task, activity),
   reads *open* / *closed*, *overdue*, *critical*, *urgent / high priority*,
   *last N days / weeks / months*, *by <column>*, *total / sum* and *pie /
   line* and builds a definition from the source's defaults.
5. Runs are stored as `AssistantConversation` kind `report_nl` and can be
   rated.

UI: the **Ask for a report** box on the *New report* page — question,
scope (every project / one project), example questions, result card
(source, grouping, filters, rows, explanation, assumptions, warnings in
amber, top groups) and **Open in the builder**, which seeds the editor with
the definition and selects its source.

## Explain these numbers (`POST /reports/narrate`)

Same body as `/reports/preview`; the result (source, totals, groups, sample
rows, projects queried / skipped, truncation) is digested and summarised:
`headline`, `summary`, `highlights` with numbers, `caveats`. Without a
provider the summary is built from the numbers (largest groups, totals,
skipped projects, truncation). Stored as kind `report_narrative`. UI: the
**Explain these numbers** button under every preview in the builder.

## Permissions

Both endpoints need `report.read` and `assistant.read`; the preview inside
`ask` and the run inside `narrate` apply the builder's per-project module
check and row visibility, so a person never sees more through the assistant
than through the builder.

## Walkthrough

1. Reports → *New report* → type "open RFIs raised in the last 30 days by
   status" → *Build it* → source RFIs, filters status in open / answered and
   raised in the last 30 days, grouped by status, 7 rows; the model's
   `ballInCourt` column is listed as dropped → *Open in the builder* → the
   editor shows the definition → *Preview* → *Save*.
2. In the preview → *Explain these numbers* → "Five of seven RFIs are still
   open…" with highlights and the skipped-project caveat.
3. Unset the provider keys → the same question is read by keywords (marked
   as such) and the explanation comes from the numbers.

## Tests

`backend/src/services/__tests__/report-assistant.service.test.js` (model
proposal repaired — unknown column, bad filter, rejected aggregate — and
previewed; keyword fallback for RFIs, manpower and punch items; unknown
source rescued; unusable model output; narrative from the numbers and
through the model) and `frontend/scripts/report-assistant-ui.test.mjs`.
