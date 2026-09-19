# OctaPM Mobile — Pilot UAT Report

**Audience:** the product owner deciding the pilot scope.
**Date:** 2026-09-18. **Branch:** `feat/p0-foundations-sprint1`.
**Status: NOT PERFORMED.**

## 1. Why, plainly

User acceptance testing means watching a person who did not build the software try to use it. This phase ran in an automated session on a Windows workstation with no participants, no devices and nobody to watch. There is no way to simulate a site engineer discovering the app, and inventing one would be worse than useless: a fabricated UAT result is the kind of evidence that gets a pilot approved and then fails in front of the client.

So: no scores, no observations, no "assistance required" counts. The protocol below is ready to run, and it is the honest deliverable of this section.

## 2. What stands in for it, and what it does not cover

Every mobile workflow has been driven end to end against the live API on the production web export, at phone and tablet sizes, by the certification suite — a machine following the path a person would follow. That proves the paths work. It proves nothing about whether a person **finds** them, understands what a screen is asking, or trusts what it tells them.

Two things it specifically cannot answer, both of which decide pilots:

- Can a site engineer who has never seen the app submit progress with a photo, in gloves, in sunlight, without being told where to tap?
- Does a PM trust the approval screen enough to approve a change order on a phone? That question is the reason PILOT-02 was fixed in this phase, and its success criterion is a human saying "yes, I can see what I'm approving" — which nobody has said yet.

## 3. The protocol, ready to run

Four participants, each on a real handset with a real build, each doing the task cold. The observer times them, records every question, and offers no help for the first ten minutes. If the participant asks "where do I click?", record **ASSISTANCE REQUIRED** against that step and then help.

| # | Participant | Task, given in their own words |
|---|---|---|
| 1 | Site engineer | "You poured the slab on grid 4 this morning, about 60% of the activity. Record it with a photo." |
| 2 | Quality engineer | "The rebar spacing on level 3 is wrong. Raise it, assign it to the subcontractor, and attach a photo." |
| 3 | Storekeeper | "Twenty bags of cement went to the level-2 slab. Issue them against that activity." |
| 4 | Project manager | "There's a change order waiting for you. Decide whether to approve it." |

Record per participant: time to complete, number of wrong turns, every question asked, whether assistance was required and at which step, and one sentence in their own words about whether they would use it on site.

Participant 4 is the one to watch hardest. The question is not whether they can find the Approve button — it is whether, before tapping it, they can say aloud what the change order is worth, why it was raised, what it does to the programme, and what evidence sits behind it. As of this phase the screen shows all four. Whether that is enough is theirs to say.

## 4. Scoring

Do not score this section until it has been run. When it has, score each participant's task out of 5 on completion without assistance, confidence, and speed, and carry the arithmetic mean into the [field pilot readiness](OCTAPM_FIELD_PILOT_READINESS.md) — using the actual arithmetic, not a rounded-up figure.

## 5. Verdict

**Pilot UAT: NOT PERFORMED.** No human has used this application. That is the single largest gap between where the product is and a field pilot, larger than any open defect, and no amount of automated certification closes it.
