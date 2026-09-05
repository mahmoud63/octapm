# Schedule delay and cost overrun prediction (OCTA-AI-PREDICT-031)

Schedule › **Forecast**: where the project is heading on its own records —
no model involved — and, on request, a plain-language explanation with
draft actions that the person confirms.

## How the forecast is computed (`forecast.service.js`)

Per active activity (from `getProjectSchedule`, plus the last 45 days of
approved progress, cost records, schedule-impact links, weather-delay links,
open RFIs / submittals / long-lead items on the activity):

| Signal | Rule |
| --- | --- |
| **Expected %** | elapsed share of the planned start → finish window. |
| **Velocity** | (last − first approved %) ÷ days between them, within 45 days; needs two updates. |
| **Projected finish** | remaining % ÷ velocity from today (`velocity`); else remaining × days-per-% used so far (`pace`); else, when already past the finish, the remaining share of the duration (`overdue`); else, when not started after the planned start, the finish shifted by the delay (`late_start`); else as planned. |
| **Slip** | projected − planned finish (days, ≥ 0); **impact days** = Σ `WorkflowActivityLink.scheduleImpactDays` (RFI / submittal / change-order links) + `WeatherDelayActivityLink.delayDays`. |
| **Float breach** | slip + impact > total float (critical = float 0). |
| **Stalled** | in progress, no approved update for > 14 days. **Late start**: nothing recorded > 7 days after the planned start. |
| **Blockers** | open / answered RFIs (overdue vs response required by), pending / under-review / resubmit submittals (overdue vs due / submit-by), undelivered long-lead items expected after the activity start. |
| **Score** | behind-plan gap × 0.7 (≤ 35) + slip × 1.5 (≤ 25) + impact × 1.5 (≤ 15) + float breach 15 (critical 10) + stalled 10 + late start 10 + blockers 3 each / 6 when overdue (≤ 15); **high ≥ 60, watch ≥ 30**. |
| **Cost** | projected = actual ÷ progress (`burn`, when ≥ 5 % and something spent) else max(budget, committed, actual, forecast); overrun ≥ 0; reasons: spent % ahead of progress by > 5 points, commitments above budget, forecast above budget; **high > 10 %, watch > 3 %**. |

Project level: **planned finish** = latest planned finish; **activity-based
finish** = latest (projected + impact) among critical or float-breaching
activities; **EV-based finish** = today + remaining days ÷ SPI (when SPI < 1)
from the official EV report; **projected finish** = the later of the two.
**Cost**: budget = revised BAC, **EAC** from the official EV, **bottom-up** =
Σ activity projections, projected = the higher; **budget lines over** =
lines whose forecast or committed + uncommitted actuals exceed the revised
budget (`budget.service.listBudgetLines`). Data-quality notes list what
would sharpen the forecast (undated activities, single progress updates, no
EV, no budget lines).

## Explanation and actions

`POST …/forecast/explain` sends the forecast (figures only) to the model
and returns `headline`, `schedule`, `cost`, `watch` and up to five draft
`actions` — `create_risk` (title, description, probability, impact,
mitigation, activity), `create_task`, `open`; activity ids not in the
forecast are dropped. Without a provider the narrative is built from the
forecast itself. Runs are stored as `AssistantConversation` kind `forecast`
on the project and can be rated. `POST …/forecast/actions` creates the risk
(register, linked to the activity; `risk.create`) or the task
(`task.create`) through their own services.

## API (tag "Assistant")

`GET /projects/{id}/forecast` (`schedule.read`), `POST …/forecast/explain`
(`schedule.read` + `assistant.read`; 409 `FORECAST_UNAVAILABLE` without a
schedule), `POST …/forecast/actions` (`assistant.read` + the record's
create permission).

## UI

Schedule › **Forecast** tab (also in the schedule menu): tiles — projected
finish vs plan, main driver, SPI / CPI, projected cost vs budget, at-risk
counts; **Explain** → narrative card with watch list, action buttons
(shown only with the permission) and feedback; **Activities driving the
finish** (done / expected, velocity, planned, projected, slip + impact,
float, score bar; click a row for the reasons, blockers as links, cost
line); **Activities over budget**; **Budget lines over**; *What would
sharpen this forecast*; **Recompute**.

## Walkthrough

1. On a project with approved progress, open Schedule › Forecast → the
   slab (critical, 40 % done against 87.5 % expected, 1.07 %/day) shows
   high risk with a projected finish 51 days late plus 5 impact days from an
   RFI link and a weather delay; MEP (stalled 21 days, overdue RFI-012,
   late switchgear) ranks first.
2. Projected finish = the later of the EV-based and activity-based dates;
   projected cost = max(EAC, bottom-up); Concrete 03-30 is listed 15,000 over.
3. **Explain** → headline, schedule / cost paragraphs, watch list, *Register
   the risk on MEP first fix* → a risk RSK-nn linked to the activity opens
   in the register; *Chase RFI-012* creates a task.
4. Unset the provider keys → **Explain** still returns a summary built from
   the forecast, marked as such.

## Tests

`backend/src/services/__tests__/forecast.service.test.js` (velocity, pace,
impacts, float breach, stalled, blockers, burn-rate and commitment cost
projection, project finish and cost, budget lines, data quality; resilience
without EV / budget lines / schedule; narrative through the model with
normalised actions and the deterministic fallback; actions through the risk
and task services) and `frontend/scripts/forecast-ui.test.mjs`.
