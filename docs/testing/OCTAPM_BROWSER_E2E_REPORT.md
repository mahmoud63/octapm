# OctaPM browser end-to-end report

**Date** 2026-09-06 · **Method** Playwright driving a real Chromium browser
against the running React app and API · **Suite** `frontend/e2e`

---

## Why this pass exists

The previous QA pass proved the API works. It could not prove the application
does, because nothing had ever driven the interface. This pass logs in through
the sign-in form, clicks through the real menus, fills real dialogs, saves real
records, reloads the page, and then checks the database to see whether what the
screen claimed actually happened.

It found four defects, three of which were invisible to every previous method.

| Measure | Result |
| --- | --- |
| Browser E2E tests | **16 passing** |
| Workspace + company routes swept | 19, all render, none crash |
| Project modules swept | 16, all render, all keep project context |
| Failed network requests across the module sweep | 0 |
| Defects found | 4 (all fixed and retested in the browser) |
| Backend regression after fixes | 152 suites, 1583 tests |

## Running it

```bash
npm run db:dev --workspace=backend      # terminal 1
npm run db:seed --workspace=backend
npm run dev --workspace=backend         # terminal 2
npm run dev --workspace=frontend        # terminal 3
npx playwright test --config=frontend/playwright.config.ts
```

`docs/qa/local-setup.md` covers the environment traps.

## What the suite covers

**`01-auth-and-navigation.spec.ts`** — sign-in through the real form; a wrong
password is refused; a session survives a full reload; every workspace, company
and project route renders without a blank page or an error boundary, with the
project still in context.

**`02-error-handling.spec.ts`** — a rate-limited billing check, a 500 on the
project list, an unknown project id, a malformed project id, and an empty form
submit. Asserts the user is never shown a Prisma stack trace and never silently
signed out.

**`03-financial-spine.spec.ts`** — company cost codes created through the
dialog; the project adopts them; budget lines created through the UI; totals
recalculated from source records and compared with the screen; workspace KPI
counts reconciled against the underlying records.

**`04-change-to-budget.spec.ts`** — a change order raised through the interface,
its evidence attached, submitted, approved, and the budget arithmetic checked to
the cent.

## The financial spine, closed

This is the chain the API pass could not finish. Every figure below was produced
by driving the interface and then recalculating from source records.

| Stage | Verified |
| --- | --- |
| Company cost codes created through the dialog | ✅ persists across reload and exists in the database |
| Project adopts the company cost codes | ✅ |
| Budget lines created through the UI | ✅ 01-CONC 500,000 · 02-STEE 350,000 · 03-MEPP 700,000 |
| Original budget totals | ✅ **1,550,000** — matches the sum of its lines exactly |
| Budget screen shows the same total | ✅ |
| Change order raised through the UI | ✅ VO-27, value 125,000 stored exactly as typed |
| Change order survives a reload | ✅ |
| Governance: submit without evidence | ✅ refused, `CHANGE_ORDER_IMPACT_PROOF_REQUIRED` |
| Submit with impact analysis, affected activity and a cited document | ✅ accepted |
| Approval | ✅ |
| **Original budget after approval** | ✅ **1,550,000 — unchanged, as it must be** |
| **Revised budget after approval** | ✅ **1,675,000 = 1,550,000 + 125,000** |
| Budget screen shows the revised total | ✅ |

Re-running adds a further 125,000 each time and the arithmetic stays exact
(1,675,000 → 1,800,000 → 1,925,000 → 2,050,000 across runs), so this is
repeatable behaviour, not a one-off.

**The commercial governance is real.** A variation cannot be submitted without
an impact summary for both schedule and cost, at least one affected activity,
**and** a cited supporting document. A generic file attachment is not enough:
the commercial record keeps its own evidence references. That is stronger
control than most systems apply, and it held under direct attempts to bypass it.

## Route audit

All 19 workspace and company routes and all 16 project modules render. No blank
pages, no error boundaries, project context preserved throughout, and zero
failed network requests during the project sweep. Detail in
`OCTAPM_FRONTEND_ROUTE_AUDIT.md`.

## What this pass did not cover

Stated plainly.

- **Only the PM role was driven through the browser.** Per-role UI behaviour,
  and whether a button hidden from one role is also refused by the server when
  invoked directly, is covered at the API level in the permission matrix but not
  through the interface.
- **Bidding, pay applications, invoices, submittals, drawings, daily logs,
  inspections, punch and meetings** have route coverage (they render) but no
  workflow coverage.
- **Procurement still has no interface.** Unchanged from the previous pass.
- **No responsive testing.** Desktop viewport only.
- **File upload through the UI** was not exercised; the change-order evidence
  was uploaded over the API.
- **Notifications** were not driven.

## A note on method

Two things nearly produced false findings, and are recorded so the next person
does not repeat them:

- A synthetic mouse click did not reach React's handlers when the browser window
  was hidden, which looked exactly like a dead button. A programmatic `.click()`
  opened the dialog, proving the handler was wired. Headless Playwright avoided
  the problem entirely. **A button that does not respond to automation is not
  automatically a defect.**
- Signing in through `page.request` shares the browser's cookie jar, so the
  second session displaced the first and the app logged itself out mid-test.
  Backend verification now uses an isolated request context.
