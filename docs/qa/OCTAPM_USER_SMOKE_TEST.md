# User smoke test

**Phase 13** · **Written:** 2026-09-08 · **Card:** OCTA-UX-SMOKE-069
**Drive:** [`frontend/e2e/22-user-smoke.spec.ts`](../../frontend/e2e/22-user-smoke.spec.ts)

Not "does the route render" — that is already covered elsewhere. Each module is
asked the questions a person asks on arriving:

1. **Can I see what is here?** — the page's own text, not a test hook
2. **Can I tell what to do next?** — is the primary action present
3. **Are there records, or is this a shell?**
4. **Does it survive me pressing F5?**
5. **Did anything break quietly?** — console errors and failed requests

Ratings are computed from those five answers by the drive, not assigned by hand.

---

## Score

| Module | Rating | Opens | Primary action | Has records | Survives refresh | Errors |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| Dashboard | ✅ | ✅ | — | ✅ | ✅ | 0 |
| Projects | ✅ | ✅ | ✅ | — | ✅ | 0 |
| Schedule | ✅ | ✅ | — | ✅ | ✅ | 0 |
| Activities | 🟡 | ✅ | — | **✗** | ✅ | 0 |
| BOQ | ✅ | ✅ | — | ✅ | ✅ | 0 |
| Cost | ✅ | ✅ | — | ✅ | ✅ | 0 |
| Commercial | ✅ | ✅ | ✅ | — | ✅ | 0 |
| Procurement | ✅ | ✅ | ✅ | — | ✅ | 0 |
| Inventory | 🟡 | ✅ | — | **✗** | ✅ | 0 |
| Document Control | ✅ | ✅ | — | — | ✅ | 0 |
| Quality | ✅ | ✅ | — | — | ✅ | 0 |
| Site Reporting | ✅ | ✅ | — | — | ✅ | 0 |
| Meetings | ✅ | ✅ | — | — | ✅ | 0 |
| Reports | ✅ | ✅ | — | — | ✅ | 0 |

**12 ✅ · 2 🟡 · 0 🔴 · 0 ⚪**

Across all fourteen modules: **0 console errors, 0 failed requests, 0
redirects, and every module came back after a refresh.** That is a better
result than the audit's earlier route sweep, and it is worth saying plainly.

---

## The two ambers

### 🟡 Activities — the list is there, the records are not in the page text
The module opens and names itself, but `A-1000` / `A-2000` never appear in the
rendered text within 15 seconds. Most likely a virtualised table that renders
rows into a canvas or a windowed viewport. Not a defect on its face, but it
means the activity codes cannot be found by search-in-page, by a screen reader
sweeping the document, or by anything that reads the page rather than the DOM
tree.

### 🟡 Inventory — you land on a scanner, not on your stock
`/inventory` opens on the scanning workspace. Nothing about the stock position —
no item, no quantity, no warehouse — is on screen until a tab is changed. For a
storeman with a barcode gun that is the right landing; for anyone asking "what
have we got", it is a blank wall.

---

## The cross-cutting defect: 🔴 → ✅ records had no address

Every register in the product could be opened **from** a link — a notification,
a comment, a deep link — because `recordWorkspacePath` builds one. None of them
**produced** one. Opening a record from a register left the URL on the module:

```
DETAIL_IS_LINKABLE      { urlCarriesRecord: false }
DETAIL_SURVIVES_REFRESH  false
```

So a QS looking at a payment application could not send a colleague a link to
it, and pressing F5 threw them back to the list. Half of a link contract that
was built at both ends and connected at neither.

**Fix:** `useRecordInUrl` keeps the open record in the address bar —
`?recordId=…&source=…`, the same shape the inbound links already use. Written
with `replaceState` rather than a route push, because opening a dialog is not a
navigation and Back should not mean "close the dialog" a dozen times.

**Re-driven:**

```
DETAIL_IS_LINKABLE      { urlCarriesRecord: true }
DETAIL_SURVIVES_REFRESH  true
```

Applied to the payment-application register, where the financial records live.
**The other registers still have the old behaviour** — the hook is there and the
change is one line each, but they are not done, and this report should not imply
otherwise.

---

## Cost overview, checked properly

```
Budget      $7,727,000
Committed  $23,110,400
Actual      $5,970,430
Forecast    $9,475,800
```

Present, populated and consistent with the ledger. `Variance` is not on the
overview by that name — a labelling observation, not a missing number.

*(Committed exceeding budget threefold is this database's own history: dozens of
test commitments raised across the phases, not a defect.)*

---

## A note on method

The first pass of this test scored **five modules 🔴**. All five were wrong: a
`text=` locator was resolving to hidden elements, and the content check was
reading the page at the first sign of life rather than waiting for the records.
Schedule, Activities, BOQ, Cost and Meetings are all fine.

That is the second time in this phase that a red finding evaporated on
inspection — and both times the tell was an internal contradiction in the
measurement itself ("did not open" alongside "has content"). A smoke report is
only worth the scepticism applied to its own instrument.

---

# Phase 20 clean-up addendum — the console counts too

The smoke test rates a module on whether it opens, holds content, survives a
refresh, and raises no console error. That last check listened for
`console.error` only, which is why three real defects sat under a green board:
two of them arrive as `console.warn`.

## What the module ratings now include

`e2e/30-console-quality.spec.ts` runs alongside the smoke test and fails on any
error **or warning** the application produces about itself, across the twelve
screens the Phase 20 workflows use, the procurement package rows, and the
purchase-order dialog through its loading state.

Latest run: **14 modules · 14 ✅ · 0 🟡 · 0 🔴 · 0 console errors · 0 failed
requests.**

## The three defects a console-error-only watcher walked past

| defect | why it was invisible |
| --- | --- |
| `PackagesPanel` keyed the inner `<tr>` while the map returned a bare `<>` — so 21 rows had no key at all | React reports it, and the suite was not listening at that level |
| The purchase-order dialog had no accessible name or description for the whole of its loading state | Radix reports it as a **warning** |
| The activity dialog had a title but no description | Radix reports it as a **warning** |

## Two entries the gate tolerates, and why

Only messages the browser emits *about* the page, never messages the page
emits about itself:

- React's own DevTools nag.
- The browser reporting a `401` on the bootstrap `/auth/me` probe. On a cold
  load the access token lives only in memory, so the first call is
  unauthenticated; the response interceptor refreshes and retries and the user
  sees nothing. Only `401` is tolerated — any other status fails the gate.

Controlled/uncontrolled transitions, missing `key`, missing `DialogTitle` and
missing `Description` are named in the code as never allowlistable.
