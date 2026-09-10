# Mainline reconciliation

**Phase 20.6** · **Written:** 2026-09-10
**Merged:** `origin/main` `fda371f` → `feat/p0-foundations-sprint1`
**Safety checkpoint:** `backup/pre-main-reconciliation-phase20-5` at `5f9da83`, on GitHub

The branch had never merged `main`. This brings 32 commits of another
developer's work in, keeps everything the parity programme built, and reverses
four changes on `main` that had disabled production enforcement.

---

## 1. The inventory

| | |
| --- | --- |
| merge base | `78bdd25` |
| commits on main, not on the branch | **32** (PRs #4–#16, from `ai-dev`) |
| commits on the branch, not on main | **136** |
| files changed on both sides | **7** |
| conflict hunks | **16** |

**A correction to the Phase 20.5 report:** it estimated "approximately 23
conflict sites". The real figure is **7 files and 16 hunks**. The 23 came from
grepping the old `git merge-tree` output, which counts marker lines and
"changed in both" notices rather than conflicts.

---

## 2. Resolution, file by file

`A` mainline wins · `B` feature wins · `C` both integrated · `D` a defect the
conflict exposed

| file | hunks | | what happened |
| --- | --- | --- | --- |
| `CHANGELOG.md` | 1 | **C** | both sections kept, in date order |
| `backend/.env.example` | 1 | **D** | feature's template kept; main's value for `CLOUDFRONT_SHARED_SECRET` is a real-looking secret and was not carried across (§5) |
| `backend/src/app.js` | 1 | **C**/**B** | feature's route mounts kept; `requireCloudFrontOriginSecret`, which main removed, restored (§4) |
| `backend/src/services/boq.service.js` | 7 | **C** | see below |
| `.../auth/sign-in/index.tsx` | 2 | **B** | main added a "Don't have an account?" link; the branch already has one in the card footer, with a test id. Taking main's would have put two on the page |
| `.../auth/sign-in/components/user-auth-form.tsx` | 2 | **B** | main's side predates OIDC SSO. Its only real change — deleting the dead GitHub/Facebook buttons — was already done on the branch |
| `.../auth/sign-up/components/sign-up-form.tsx` | 2 | **B** | whitespace where those buttons had been |

### boq.service.js — the one that mattered

The file conflicted in seven places and the two sides never actually met.
Main's diff is 364 lines because it was reformatted from double to single
quotes; underneath, its only real change is inside `buildBoqActivityPrompt`,
which the branch never touched. Every conflict hunk was the branch's newer work
against main's reformatted copy of the code it replaced:

- the durable job service (`jobService` / `JobError`) against the old in-memory
  `boq/job-store`
- "a bill row may name the activity it belongs to" against the old
  `activityName is required`
- split allocation against the old unconditional allocate-on-create

All seven resolved to the branch. **Main's prompt work was kept** — it merged
cleanly on its own and is in the result: `Number(contractValue)` so a Decimal
formats, sanitised BOQ rows so a malformed Excel export cannot inject
`undefined`/`NaN`, and the nine-rule prompt with cross-BOQ-item sequencing.

Main also added `module.exports = { buildBoqActivityPrompt };` beside the
function. The file's real export block sits 500 lines further down and
overwrites it, so on main that function **is not actually exported**. The
intent was carried over properly: it is now named in the real export list.

The quote reformat came through wherever it did not conflict, and was rejected
wherever it did — which is what a merge does, and it leaves the file in **both
styles**: ten single-quoted requires and eight double-quoted. It compiles and
behaves identically, and the file's neighbours in `backend/src` are
double-quoted.

Normalising it was considered and not done. There is no prettier config to
appeal to, and rewriting 2,100 lines of quotes with a regex is how you silently
corrupt an apostrophe inside a template literal — which is exactly what
happened to a scratch copy while reading this diff (`the BOQ item's rate`
became `item"s`). A cosmetic inconsistency is a smaller problem than a
mangled AI prompt. Logged as P2.

---

## 3. What main disabled, and how it went unnoticed

Four changes on `main` removed production enforcement. They arrive through
commits titled `fix`, `.`, `d`, `fix prompt` and `allow origin list` — the
shape of someone unblocking a deployment.

| | on main | restored |
| --- | --- | --- |
| `isCorsOriginAllowed` | `return true; // Allow all origins unconditionally` | reads the allowlist again |
| `validateProductionCorsOrigins` | body deleted, replaced by `// CORS validation bypassed` | restored |
| `validateProductionEnv` | `if (env.NODE_ENV !== 'productio')` | `'production'` |
| `requireCloudFrontOriginSecret` | import and `app.use` deleted | restored |

That third one is a typo, and it is the serious one. With it, the guard returns
early for `NODE_ENV=production`, so **every** production check is skipped in the
one environment they exist for: secret length, secret reuse, Stripe
configuration, the private uploads bucket, CORS.

This is not an interpretation. `security.test.js` is **unchanged on main** and
asserts all of it. Putting the typo back:

```
Tests: 7 failed, 4 passed, 11 total
```

**Main's tip fails its own test suite.** It went unnoticed because commit
`ffbaa62` (titled ".") deleted `.github/workflows/quality-gates.yml` and
`.github/workflows/openapi.yml` — the CI that ran those tests. What remains,
`deploy.yml`, runs no test or validation step at all and deploys on push.

Both workflows are restored, **as main last had them** (`0f120c6`), so the
`prisma generate` step main added to each is kept.

The CloudFront guard is safe to restore: it no-ops unless `NODE_ENV` is
`production` *and* `CLOUDFRONT_SHARED_SECRET` is set.

### For the user to decide

Restoring the CORS allowlist means a deployed frontend origin must be listed in
`CORS_ALLOWED_ORIGINS` or `FRONTEND_URL`. That is configuration, and it is
where widening CORS belongs. If the deployment currently relies on allow-all,
set those variables before deploying this branch.

---

## 4. A credential to rotate

`backend/.env.example` on main sets `CLOUDFRONT_SHARED_SECRET` to a specific
non-placeholder string rather than the `development-only-change-in-production`
placeholder. The merged branch keeps the placeholder.

If that string is or was the live CloudFront secret, **it is in the git history
of a GitHub repository and should be rotated.** Removing it from the tip does
not remove it from history.

---

## 5. Two more unsafe reference generators

Phase 20.5 moved 34 registers onto the atomic counter and reported the class
closed. It was not. The audit grepped for `count + 1` and `_max: { number }`;
these two are written in raw SQL and matched neither:

| | table | reference |
| --- | --- | --- |
| `nextReceiptNumber` | `DeliveryReceipt.receiptNumber` | `GRN-00001` |
| `nextOrderRef` | `ProcurementOrder.ref` | `PO-00001` |

Both read `MAX(...) + 1`, which is gap-safe and race-unsafe. The goods-receipt
one said so itself: *"the unique index remains the real guarantee — this only
stops it firing in ordinary use."* Two people receiving at the same moment read
the same maximum, and the second loses on `@@unique([projectId, receiptNumber])`
with an HTTP 500.

Both now call `nextRef`. Seeding is byte-for-byte what it was — same prefix,
same pad, same `^GRN-[0-9]+$` pattern, so a supplier's own "GRN-x5xm3-A" still
cannot drag the sequence anywhere.

`src/services/__tests__/raw-sql-reference-numbering.test.js`, against the real
database: 20 simultaneous callers get 20 distinct references in a contiguous
run, the reference issued collides with no existing row, and the sequence never
goes backwards.

**Mutation:** restoring `MAX + 1` on the goods-receipt generator fails **3 of
its 4 cases** while the purchase-order cases, still on the counter, stay green —
so the test discriminates the mutated generator rather than merely being red.

The audit now covers raw SQL as well:

```
$ grep -rn "MAX(" src --include=*.js | grep -v __tests__ | grep -v reference-number.js
(only comments describing the history)
```

The three remaining `_max:` aggregates are not references — a BIM model
version, a lookahead sort order, and two date maxima.

---

## 6. A build that was already broken

`tsc -b` failed on the certified baseline, before this merge touched anything:

```
goods-receipt-panel.tsx(154,18): error TS2345
  Type '{ receiptId; receiptNumber; movements }' is missing the following
  properties from type 'ReceiptResult': warehouse, order, lines
```

The shape was declared twice — once in the API client, once beside the
component — and the client's copy stopped at `movements` after the server had
grown the rest. Nothing caught it: Playwright drives the Vite dev server, which
does not typecheck, and no gate ran the build. Restoring `quality-gates.yml`,
which runs `npm run build`, made it matter.

Fixed at the source: `GoodsReceiptResult` is exported from the API client and
the component imports it, so there is one declaration to drift from.

---

## 7. Mainline work taken as-is

| | |
| --- | --- |
| `utils/money.js` | falls back to the Prisma runtime `Decimal` when the client has not been generated. **Arithmetic unchanged** — same Decimal `.plus`, same scale of 2. The removed `MONEY_MAX_DECIMAL` was unused |
| `config/db.js` | lazy `PrismaClient` behind a Proxy, so importing the module does not throw before `prisma generate` |
| `middleware/error-handler.js` | stops logging stack traces for expected 4xx |
| `utils/__tests__/money.test.js` | +1 test, and it is in the 1,908 |
| infrastructure, terraform, `deploy.yml` | taken unchanged |
| `backend/tmp_read.js`, `docs/boq-fail.xls` | kept. A one-off script and the 1.4 MB customer BOQ it reads — debris from a real parsing bug, and not mine to delete |

---

## 8. Gates on the merge commit

| gate | result |
| --- | --- |
| Jest | **1,908 / 1,908** across 176 suites |
| Targeted (BOQ, money, security, RBAC, numbering, procurement, inventory, subcontract, cost…) | **1,068 / 1,068** across 50 suites |
| OpenAPI | **733 documented paths** |
| `prisma validate` | valid |
| `tsc -b` | clean |
| `vite build` | clean |
| Playwright | **144 / 144**, `retries: 0` |
| Console gate | 0 OctaPM errors · 0 warnings |
| Smoke | 14 ✅ · 0 🟡 · 0 🔴 |
| 429s / 5xx / API restarts | 0 / 0 / 0 |

Jest went 1,898 → 1,908: +1 from main's money test, +9 from the new
concurrency suite. Suites 175 → 176.

Schema: main changed no model and no migration, so there was nothing to
reconcile. `ReferenceCounter` and `20261001090000_add_reference_counter` are
present and `prisma validate` passes. No migration was reordered or removed,
and `prisma migrate deploy` was not run anywhere.

---

## 9. Still open

**P1:** none.

**P2**

- Match picker lists `take: 100` purchase orders with no paging or search.
- `listAssignableUsers` returns `take: 200`. Search is server-side so people
  stay findable by typing; an unsearched list truncates on a large org.
- `backend/tmp_read.js` is committed debris.
- `boq.service.js` is half single-quoted and half double-quoted after the
  merge (§2). Worth one deliberate formatting pass, with the prompt's template
  literals checked by eye.
- Controlled/uncontrolled React warnings from Phase 20 remain unreproducible;
  the console gate treats them as never-allowlistable.

**For the user, not the branch**

- Rotate `CLOUDFRONT_SHARED_SECRET` if the value in main's history is live (§4).
- Set `CORS_ALLOWED_ORIGINS` / `FRONTEND_URL` for the deployed frontend before
  deploying this branch (§3).
- `main` still carries the four disabled guards, the deleted CI and the failing
  security tests. This branch fixes them **for this branch**; nothing here
  changes `main`.
- `prisma migrate deploy` on staging/production, and the Phase 16 plan-column
  SQL repair, both still outstanding.
