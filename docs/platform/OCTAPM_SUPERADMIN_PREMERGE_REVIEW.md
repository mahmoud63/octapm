# Superadmin V1 — pre-merge Codex review and dispositions (2026-10-04)

One read-only Codex review of the frozen branch (`5034c03`), sandbox
`read-only`; the working tree was clean and HEAD unchanged afterwards. Scope:
platform authorization, grant/revoke, MFA, customer-content privacy,
telemetry privacy, analytics tenant scoping, platform audit, fail-closed
behaviour, event spoofing, aggregation correctness, migration/index safety,
N+1/unbounded queries. Verdict: no P0, no P1, **no authorization bypass**.

Every finding was verified before any change: CX-1/2/3/5/8 by live tests that
failed on `5034c03`, CX-6 by a unit test (mutation-proven), CX-4 and CX-7 by
reading the code (CX-4 later also by a live test and an axios proof).

| ID | Class | Finding | Disposition |
|---|---|---|---|
| CX-1 | P2 | Platform audit stored free text from the path, unrecognised query names and a client-chosen request id | FIXED `94ad42b`: route pattern (documented route words only), allow-listed query names, UUID request ids only |
| CX-2 | P2 | Error route normalisation kept word-shaped customer text (`/projects/confidential-client/rfi`) | FIXED `94ad42b`: a segment survives only if it is a literal word of the documented `/api/v1` routes |
| CX-3 | P2 | Refusals of an inactive account were not audited | FIXED `94ad42b`: audited with status 401 |
| CX-4 | P2 | Queued web screen-opens could be sent under another workspace/person | FIXED `94ad42b` (principal-bound queue) + follow-up after the recheck (no retry after 401; batch declares `workspaceId`, server drops a batch for another workspace) |
| CX-5 | P2 | Share of eligible companies could exceed 100% | FIXED `94ad42b`: one live-company set (active, ≥ 1 active member) for numerators and denominators |
| CX-6 | P3 | Spike median ignored zero-error days | FIXED `94ad42b`: zero-filled 14-day series |
| CX-7 | P2 | Analytics counted the whole ProductEvent history per request | FIXED `94ad42b`: window-bounded count + first event by index |
| CX-8 | P3 | A page past the end reported total 0 | FIXED `94ad42b`: total taken from page 1 |

## Targeted recheck (one, no loop)

Codex re-read `5034c03..94ad42b`: CX-1, 2, 3, 5, 6, 7, 8 **CORRECT**; no
regression (server event rules still match, audit paths sensible, intake still
tenant-checked, denominators consistent, `totalOf` recurses at most once,
tracking never throws); no new finding. CX-4 **INCOMPLETE**: a batch sent with
an expired token is retried by `apiClient` after the refresh re-binds the
session to the *current* workspace. Fixed after the recheck (see table); proof:
a live test (a batch declaring another workspace is dropped whole; the check
mutated away → the test fails), an axios proof that the `_retry` flag reaches
the interceptor (no refresh-and-resend), and a browser run in which the batch
carries `workspaceId` and lands on the PM's own project. Per the owner's
instruction this follow-up was not sent for another Codex round.
