# OctaPM UAT Defect Register

Everything raised by a human being using OctaPM in a training or pilot session goes here. It is
empty until the first session: filling it with examples would put invented defects in front of the
people deciding what to fix.

Findings from the documentation phase live in the product findings register and its disposition,
not here. If a participant runs into one of those, record it here anyway and name the existing
identifier in the last column. Two people hitting the same thing on the same morning is evidence
that it matters; one person writing it down twice is not.

## How to classify

Every entry gets one severity and one kind.

### Severity

| Code | Meaning | Test |
| --- | --- | --- |
| **UAT-P0** | Cannot safely operate | The participant could create wrong data, or lose work, and not know |
| **UAT-P1** | Core workflow cannot be completed independently | They got there only with help, or not at all |
| **UAT-P2** | Significant confusion or waste | They finished, but by a route nobody would choose twice |
| **UAT-P3** | Polish or preference | It works; they would rather it did not look like that |

Severity is about consequence, not volume. Ten people mildly irritated is still P3. One person
approving the wrong value without noticing is P0.

### Kind

| Code | Meaning |
| --- | --- |
| **TRAINING GAP** | The product is right; the session did not prepare them |
| **UX DEFECT** | The product works but does not explain itself |
| **PRODUCT DEFECT** | It does the wrong thing |
| **PERMISSION ISSUE** | A role can do something it should not, or cannot do something it should |
| **DATA ISSUE** | The records shown were wrong, stale, or from somewhere else |
| **DOCUMENTATION ISSUE** | The guide is wrong, missing, or out of date |

If a finding is a training gap and a usability defect at once, it is a usability defect. The
distinction is decided by one question: would a second session fix it? If the answer is "only if we
warn them", it is a defect.

## The register

| Ref | Date | Participant | Role | Scenario | What was expected | What happened | Severity | Kind | Existing finding | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | | | |

Use `UAT-001` onwards, in the order raised. Keep a row even after it is fixed; a register that only
holds open items cannot show whether the product is getting better.

## Status

| Status | Meaning |
| --- | --- |
| OPEN | Raised, not yet looked at |
| TRIAGED | Severity and kind agreed, owner assigned |
| FIXED | Changed and verified by the person who raised it, where possible |
| WON'T FIX | A decision, with the reason written down |

"Won't fix" needs a sentence. A register full of closed items with no reasons is how the same
complaint comes back three sessions running.

## What to do at the end of a session

1. Read the register out to the room before people leave. Somebody will remember something.
2. Triage the same day, while the session is fresh, with the observers present.
3. Count how many findings were the three known ones. If most were, the session found nothing new,
   and the next one should use harder scenarios or different people.
4. Anything at P0 or P1 stops the pilot conversation until it has an owner and a date.

## Session summary

One of these per session, kept with the register.

| Field | Value |
| --- | --- |
| Session date | |
| Participants | |
| Roles covered | |
| Scenarios attempted | |
| Scenarios passed | |
| Completed without assistance | |
| Assistance events | |
| Findings raised | |
| P0 | |
| P1 | |
| P2 | |
| P3 | |
| Already known | |
| Average confidence | |
| Trainer | |
