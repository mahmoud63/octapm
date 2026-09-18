# OctaPM Mobile — Web ↔ Mobile Propagation

**Audience:** the pilot lead, and anyone who needs to know how quickly what one side does shows up on the other.
**Status:** measured on 2026-09-18 against the production web export and the local API, in the dedicated end-to-end organisation, by `mobile/e2e/cert-propagation.spec.ts`. "Web" means the same API routes the web platform calls; "mobile" means the app running on the web target, either its open screen or a request carrying the mobile client header.

## 1. There is one record, not two

The app has no database, no cache of record of its own and no second permission model. It reads and writes the same Express API and the same PostgreSQL rows as the web platform. So a change is never "copied" from one side to the other: the question is only **how soon an already-open screen notices**, and that is what the classes below measure.

| Class | Meaning |
|---|---|
| REALTIME | the open screen shows it within 5 seconds, with no reload |
| NEAR REALTIME | the open screen shows it within 20 seconds, with no reload |
| REFRESH REQUIRED | the open screen shows it after a reload, pull-to-refresh or leaving and returning |
| STALE | not shown even after a reload |
| IMMEDIATE (same record) | no propagation involved: the other side reads the record the writer just created, and it is there on the first read |

## 2. The eight handoffs

| # | Handoff | Class | Measured |
|---|---|---|---|
| 1 | Mobile raises an RFI → web answers it officially → the open mobile record shows the answer | REALTIME | 972 ms, no reload |
| 2 | Web assigns an NCR → the open mobile NCR list shows it | REALTIME | 901 ms, no reload |
| 2b | Web edits that NCR's severity with no status change → the open mobile record | REFRESH REQUIRED | not shown within 20 s; shown after a reload |
| 3 | Web issues a purchase order → mobile receives part of it → the open mobile order record shows the receipt | REALTIME | 154 ms, no reload |
| 4 | Mobile issues material → the web sees stock and project cost move; the open item screen | REALTIME, and IMMEDIATE on the web | 159 ms on the screen; the web reads the new stock and cost on the first read |
| 5 | Mobile submits progress → the open activity shows the submission | REALTIME | 869 ms, no reload |
| 6 | Web assigns a task → the open mobile task list shows it; mobile completes it → the web state | REALTIME | 876 ms to the list; the completion is on the web state immediately |
| 7 | Mobile raises a change event on the screen → the web commercial record | IMMEDIATE (same record) | readable 48 ms after the app's request returned |
| 8 | Web starts an approval → the open mobile inbox shows the step; mobile answers it → the web status | REALTIME | 724 ms to the inbox; the answer is on the web status immediately |

## 3. Why some are not realtime

The app subscribes to the server's socket and, on each domain event, marks the affected project's queries stale so the open screens refetch. It never applies an event's payload to its cache: what is shown always comes from the API. A handoff is therefore realtime exactly when the server publishes a domain event for that step.

Measured on the certified bundle, only one row is not realtime: a web edit to an NCR that does not change its status. That is exactly the gap the read-only audit found in the server, and the three it found are:

| Gap | Where | Effect |
|---|---|---|
| An NCR assignment or field edit with no status change publishes no event | `backend/src/services/ncr.service.js` | Row 2b: the open record does not refetch on its own |
| Stock movements (issue, receive, transfer) publish no domain event | `backend/src/services/inventory.service.js` (`postMovement`) | Rows 3 and 4 still met the five-second bar because those screens refetch when they are mounted and when they regain focus, not because an event arrived |
| A workflow step response and a step assignment publish no event; only the final decision does | `backend/src/services/workflow-engine.service.js` | Row 8 likewise |

These are SRV-01 to SRV-03 in the [known issues](OCTAPM_MOBILE_KNOWN_ISSUES.md). They are server-side and were left alone deliberately: the brief's rule is to classify propagation honestly during certification, not to change the platform's event model. Adding the NCR event would move row 2b to realtime; adding the other two would make rows 3, 4 and 8 realtime by event rather than by refetch, which is the more dependable basis.

One client-side gap was fixed here: the inventory query keys sit outside the project scope the socket invalidates, so even an emitted inventory event would not have refetched the inventory screens. That is CERT-11.

## 4. What the person sees in the meantime

Nothing is silently stale. Every list and record carries a freshness line with the age of what is shown and whether a fetch is in flight; pull-to-refresh works on every register; switching away and back refetches. Offline, the freshness line says so and the connectivity bar appears. The classes above are about the app noticing on its own, not about the person being stuck.

## 5. Reproducing this

```bash
cd mobile && npm run export:web          # the certified bundle
npm run serve:web                        # port 8081, or attach to the running one
npx playwright test --config e2e/playwright.config.ts cert-propagation.spec.ts --project=phone
```

The checks write to the dedicated end-to-end organisation only. Each one times the arrival from the moment the server confirms the other side's change to the moment the open screen shows it, polling four times a second for twenty seconds, then reloading once and polling for ten more before calling a row stale.
