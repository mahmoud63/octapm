# Greenfield blocker certification

**Phase 20.5** · **Written:** 2026-09-09
**Cards:** OCTA-API-REFNUM-111 · OCTA-QA-POOL-112 · OCTA-QA-AUTHLIMIT-113
**Status:** **NOT COMPLETE** — one approved P1 remains unstarted. See §7.

Phase 20.5 was scoped to close the two P1s that could invalidate a full-system
simulation: unsafe reference numbering, and the inability to put a team on a
project. The numbering work turned out to be roughly three times its stated
size and consumed the phase. The team work is not started, and this document
says so rather than reporting around it.

---

## 1. Numbering — the audit

The brief listed eleven services and said not to assume it was exhaustive. It
was not. Searching the codebase found **34 call sites across 29 files**, in two
families.

### Family one — `count + 1` (22 sites)

Collides the moment anything is deleted: the seeded project held 53 bid
packages numbered up to 73, so the next create asked for 54, which already
existed, and died on the unique index with an HTTP 500.

| in the brief | found in addition |
| --- | --- |
| budget revision, change order, correspondence, defect, drawing set, drawing, EOT, inventory, IPC, ITP, material test | meeting, NCR, RFI, risk, safety, submittal, task, transmittal, prime contract, **weekly reports (a route, not a service)** |

### Family two — `MAX(number) + 1` (12 sites)

The brief warned against this specifically: *"Do NOT simply replace count + 1
with MAX + 1 everywhere without checking concurrency."* It is gap-safe and
race-unsafe — two transactions read the same maximum, both write it, and the
second loses on the unique index. READ COMMITTED, which is what these run at,
does not prevent it.

change events · RFQs · commitments · commitment change orders · direct costs ·
form instances · lookaheads (×2) · punch items · sub pay apps · submittal
packages · **bid packages**

That last one is worth naming: Phase 20's own fix moved bids off `count + 1`
and onto `MAX + 1`, which is exactly the half-measure this phase was told to
avoid. The same defect, in the same codebase, arrived at twice by different
routes.

### After

```
$ grep -rnE "count \+ 1|_max: \{ number" src --include=*.js | grep -v __tests__
(nothing)
```

---

## 2. The numbering architecture

One strategy, in `backend/src/utils/reference-number.js`, backed by a
`ReferenceCounter` table added in `20261001090000_add_reference_counter`.

```sql
INSERT INTO "ReferenceCounter" ("scope", "next", "updatedAt")
VALUES (scope, seed, NOW())
ON CONFLICT ("scope") DO UPDATE
  SET "next" = "ReferenceCounter"."next" + 1
RETURNING "next"
```

**One statement.** Atomic under any isolation level, and it works whether or
not the caller sits in a transaction — which matters, because these 34 sites
are split roughly evenly between the two. A `pg_advisory_xact_lock` would have
required every caller to be inside a transaction; several are not.

Two entry points over the same counter:

| helper | for | seeds from |
| --- | --- | --- |
| `nextRef` | registers whose reference is a text column (`COR-003`) | the highest reference already matching `PREFIX-\d+` |
| `nextNumber` | registers with an integer `number` column and a separately formatted ref | `MAX(number)` in that scope |

`nextNumber` takes a **compound scope**, because several registers number
separately per type or kind — a subcontract and a purchase order each have
their own run within a project.

### Three properties, stated rather than assumed

- **Gaps are not filled.** `CO-001, CO-002, CO-004` yields `CO-005`. Filling
  `CO-003` would reuse a reference somebody may already have quoted in an
  email. Uniqueness beats tidiness, which is what the brief asked for.
- **Deleting the newest record does not roll the counter back.** A reference is
  never handed out twice even if the row that held it is gone.
- **Hand-written references are ignored when seeding.** `VO-SPECIAL`, or a
  reference carried over from a finance system, cannot drag a sequence
  somewhere strange.

Identifiers are validated before interpolation (table, column, prefix), and the
tests prove a table name or prefix carrying SQL is refused.

---

## 3. Concurrency, gap and mutation results

Run against the real database, not a mock: whether the statement is atomic is a
question about PostgreSQL, not about JavaScript.

| check | result |
| --- | --- |
| 2 simultaneous callers | 2 distinct references, numbers `[1, 2]` |
| 20 simultaneous callers | 20 distinct, and a contiguous run — nothing skipped |
| 20 simultaneous on a **cold scope** | 20 distinct. The riskiest case: every caller reads the same seed, one insert wins, nineteen fall through to the increment |
| gap after deletion | `001, 002, 003` issued, `003` deleted → next is `004`, not `003` |
| seeding past an existing run | 90 change orders `VO-01..VO-90` → next is `VO-91` |
| hand-written references | ignored; a fresh prefix still starts at `001` |
| unsafe table name / prefix | refused |

**Sizing:** 20, not 50. The property is that racing callers get distinct
numbers, which 20 proves as well as 50; 50 exhausted the local cluster
(`max_connections` 100, the rest of the suite already holding ~43). A test that
fails on the harness rather than the product teaches nobody anything.

### Mutation

Restoring `count + 1` inside the helper: **9 of 14 cases fail**, including
every concurrency case and both gap cases. Restored, all 14 pass.

---

## 4. Connection pool — measured, not guessed

The brief said not to raise `max_connections` to hide leaked connections. It
was not raised; nothing about PostgreSQL's configuration was touched.

| state | idle connections |
| --- | --- |
| baseline, only the API and web running | **34** |
| peak during a full Jest run | **~56 of 100** |
| after the run | back to baseline |

Four real-database suites were walking away from their pools. They now
disconnect (`cursor-pagination`, `record-assignment.models`,
`reference-numbering`, `reference-number`), with the disconnect placed **after**
the row cleanup so it does not force a reconnect mid-teardown.

The one timeout that survived the fix was **cold start, not contention**:
`listSources` measured at **1,423 ms on the first call and 3 ms on every call
after it**. The leak was fixed first, then that single test's timeout was sized
to the measured cost. In that order, and the measurement is in the file.

---

## 5. The 429, and a measurement error worth recording

The Phase 20 clean-up reported *"zero 429s across 1,612 logins"* and concluded
the rate limiter was never involved. **That was wrong.** The count came from
`grep -c ' 429 '` against a log where morgan colourises the status, so the ANSI
escape codes meant the pattern never matched. There were 25.

Counted correctly:

```bash
sed 's/\x1b\[[0-9;]*m//g' api.log | grep -cE " 429 "
```

The culprit is not the **login** limiter, which is what both the brief and the
earlier analysis assumed. It is **`authLimiter`**, which covers everything
under `/api/v1/auth` — including the `/auth/me` probe the app makes on every
cold page load.

```
requests under /api/v1/auth in one 13.7-minute run   2,025
RATE_LIMIT_AUTH_MAX (local .env)                     2,000
window                                               15 minutes (default)
```

One budget for the whole run. It ran out at request 2,001 and every `/auth/*`
call afterwards returned 429 — login, `/auth/me`, `sso/lookup`, `refresh` —
failing eight specs.

**Fixed in local configuration only.** `backend/.env` (untracked) now also
sets `RATE_LIMIT_AUTH_WINDOW_MS=60000`, so the budget refreshes during a run.
**The production defaults in `rate-limit.js` are unchanged — 80 requests per
15 minutes per IP.** No test-only bypass was added to the middleware.

---

## 6. Gates

| gate | result |
| --- | --- |
| Jest | **1,898 / 1,898** across 175 suites |
| OpenAPI | **731 documented paths** |
| Playwright | **141 / 141** (14.5m) |
| Console gate | 0 OctaPM errors · 0 OctaPM warnings |
| User smoke | 14 modules · 14 ✅ · 0 🟡 · 0 🔴 |
| 429s during the run | **0** |
| API restarts during the run | **0** |

`retries: 0` throughout. No test was weakened, skipped or re-scoped. The one
assertion that changed — the bid numbering test — was **corrected, not
relaxed**: it had asserted `number === highest + 1`, which is the `MAX + 1`
contract, and now asserts the property that actually matters (strictly past
everything issued, colliding with nothing).

### Four test instruments fixed, each of which had been reporting success

| instrument | how it was lying |
| --- | --- |
| mocked Prisma clients in 17 suites | could not answer the raw queries at all |
| the counter double | returned a flat zero where fixtures say "pretend six exist"; it now delegates to the suite's own `aggregate` stub so each fixture stays authoritative |
| the counter double, again | its map leaked across tests in a file, so the second test started where the first finished; it now registers its own `beforeEach` reset |
| four real-database suites | never released their pools |

---

## 7. What is NOT done

**Project team assignment — P1, unstarted.** Brief sections 1 to 4: adding an
existing company colleague to a project through the UI, the separate
*Add to Project* and *Invite by Email* paths, the per-persona permission drive,
and removal affecting only one project.

This is unchanged from the Phase 20 finding (OCTA-UX-TEAM-093): there is no API
or UI path to add an existing colleague to a project, only an email invitation
they must accept, and `setProjectUserPermission` refuses with
`PROJECT_USER_NOT_MEMBER` — *"Assign the user to the project before setting a
permission template"* — an instruction the product does not implement.

It matters for the greenfield simulation exactly as the brief says: a newly
created project has a team of one, and every non-PM persona is refused with
`PROJECT_ACCESS_DENIED`. Every persona test in this programme runs on the
seeded project because of it.

**Phase 20.5 is therefore not complete.** The numbering blocker is closed and
proven; the team blocker is open.

## 8. Still P2

- **Match picker** lists `take: 100` purchase orders with no paging or search,
  so on a project with more than a hundred the older ones are unreachable from
  that screen.
- **Controlled/uncontrolled React warnings** reported in Phase 20 remain
  unreproducible; the console gate treats them as never-allowlistable and will
  fail if they appear.
