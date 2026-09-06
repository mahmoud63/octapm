# OctaPM frontend technical defects

Console errors, failed network calls and rendering faults collected while
driving the application in a real browser. Everything here was observed, not
inferred.

## Fixed during this pass

### FE-001 — A transient failure on the session check logs the user out

**Severity** Critical · **Status** Fixed, retested in the browser

`routes/_authenticated/route.tsx` called `/auth/me` on every full page load and
treated **any** exception as proof the session was gone: it cleared the auth
store and redirected to the marketing landing page.

So a rate limit, a 500, a timeout or a dropped connection during that one call
signed the user out and discarded whatever they were entering. Reproduced by
returning a single 429 from `/auth/me`: the browser ended on
`http://localhost:5173/landing`.

**Fix** Only a 401 now means "not signed in". Anything else is retried once and
then ridden out with the session intact — the request layer already refreshes an
expired token, so a non-401 is a fault, not a verdict.

**Retest** `02-error-handling.spec.ts` › "a transient failure on the session
check does not log the user out" — passing.

### FE-002 — The Reports page crashed into an error boundary

**Severity** Critical · **Status** Fixed, retested in the browser

`/reports` rendered "500 — Oops! Something went wrong" with
`TypeError: sources.find is not a function`.

Root cause was in the backend: `listDefinitions` returned
`sources: listSources()` without `await`. `listSources` is async, so JSON
serialised the pending Promise as `{}`. The frontend guarded against `undefined`
(`data?.sources ?? []`) but not against the wrong *type*, so `.find()` was
called on an object and took the page down.

**Fix** Both sides. The backend awaits (`sources: await listSources({ orgId })`),
and the frontend guards the type (`Array.isArray(data?.sources) ? … : []`) so a
malformed payload degrades instead of crashing. A backend regression test pins
the shape.

**Retest** `/reports` renders; the payload returns 24 sources as an array.

### FE-003 — Every calendar date displayed a day early

**Severity** Major · **Status** Partially fixed

Calendar dates are stored as UTC midnight and were rendered with
`new Date(value).toLocaleDateString()`, which converts to the viewer's timezone.
In `America/Chicago` the project list showed:

| Field | Stored | Displayed |
| --- | --- | --- |
| Start date | 2026-01-12 | **1/11/2026** |
| End date | 2026-11-27 | **11/26/2026** |
| Data date | 2026-06-30 | **6/29/2026** |

On a construction project these are contract dates. A completion date shown a
day early is a liquidated-damages date shown a day early, and the data date is
the cutoff for all earned-value reporting.

**Fix** Added `frontend/src/lib/dates.ts` with `formatShortDate`,
`formatLongDate`, `formatDateTime` and `toDateInputValue`. Calendar dates render
from their UTC components so they show the same day in every timezone;
`formatDateTime` stays local, which is correct for audit timestamps.
`projects-list.tsx` now uses it and was verified in the browser: 1/12/2026 and
11/27/2026.

**Still open.** `toLocaleDateString` is called directly in **57 files**. Only the
project list is converted. The project detail header still shows
`1/11/2026 -> 11/26/2026`. Migrating the rest is mechanical but wide, and each
call site needs judging: a due date should use `formatShortDate`, a comment
timestamp should stay on `formatDateTime`.

## Open

### FE-004 — Five different list envelope shapes

**Severity** Minor · **Priority** P2 · **Status** Open

The same idea — "a page of records" — comes back under five different keys:

| Endpoint | Shape |
| --- | --- |
| `/projects` | `data.items` |
| `/notifications` | `data.rows` |
| `/projects/{id}/budget/lines` | `data.lines` |
| `/projects/{id}/change-orders` | `data.orders` |
| `/projects/{id}/activities` | a bare array as `data` |

Every client has to special-case each one, and the bare array cannot paginate.
This costs the mobile team, which consumes the same Swagger. Normalising is a
breaking change and belongs in a versioned migration with the frontend updated
alongside — not a drive-by fix.

### FE-005 — The subscription is fetched on every navigation

**Severity** Minor · **Priority** P3 · **Status** Open

`/billing/subscription` is called on each route change. The billing limiter
allows 60 per window, so ordinary navigation can trip it. Now that FE-001 is
fixed a 429 no longer signs the user out, but the call is still wasteful.
Caching it with a long `staleTime` would remove the problem.

### FE-006 — No client-side validation on the cost code form

**Severity** Minor · **Priority** P3 · **Status** Open

Submitting the New cost code dialog empty sends the request and relies on the
server to reject it. The dialog correctly stays open rather than pretending to
succeed, so nothing is lost — but the round trip is avoidable and the user waits
for it.

## Observed and acceptable

- **401s on `/auth/me` and `/auth/refresh` before sign-in.** The app probes for
  an existing session and is told no. Correct.
- **The login rate limiter fires under automated load.** Working as designed.
  The QA environment raises the limits in `backend/.env`; production must not.

## Two things that looked like defects and were not

Recorded so they are not "found" again.

- **A button that ignored a synthetic click.** The New cost code button appeared
  dead under browser automation. A programmatic `.click()` opened the dialog,
  proving the handler was wired — the window was hidden, so the browser was not
  dispatching real mouse events. Headless Playwright works correctly.
- **The app logging itself out mid-test.** Caused by the test signing in through
  the page's own request context, which shares the cookie jar; the second
  session displaced the first. Backend verification now uses an isolated
  context.
