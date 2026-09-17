# OctaPM Trainer Guide

For the person running the session. Not for participants: it says what to withhold.

Your job in Levels 1 and 2 is to teach. Your job in Levels 3 and 4 is to keep your mouth shut and
write down what happens. Those are different jobs, and the second one is harder.

## What the session is for

You are not demonstrating that OctaPM works. That has been tested. You are finding out whether a
quantity surveyor who has never seen it can raise a change order without being shown, and whether
the person who has to approve it knows it is waiting.

Every time you tell somebody where to click, you spend a piece of the evidence you came for. Spend
it deliberately, and record it.

## Preparing the room

- **One organisation, prepared clean.** One live project, no archived projects, no leftover
  companies. Archived work makes global counts and inventory views include records nobody in the
  room has seen, and the session is then spent explaining them.
- **Accounts ready before anyone arrives.** Each participant signs in as themselves, in their own
  role. Do not share one account: half of what you are measuring is what each role can see.
- **Two browsers per pair for Level 3.** Handoffs are the point. If two people share a screen you
  cannot see whether the work arrived.
- **Printed packs.** Participants write on paper. Asking them to type feedback into the thing being
  tested contaminates it.

## Running each level

**Level 1, about twenty minutes.** Lead from the front. Everybody does the same steps at the same
time. Wait for the slowest person before moving on. This level exists so that nobody fails Level 4
because they could not find the sign-in page.

**Level 2, about forty minutes.** Name the module, not the button. Walk the room. When somebody
gets stuck, note what they tried before you help.

**Level 3, about an hour.** Set the scene, then stop talking. Let the handoff succeed or fail on
its own. The most useful thing you will see all day is somebody waiting for work that has already
arrived and that they have not noticed.

**Level 4, ten to fifteen minutes each.** One participant, one observer, one scenario. Sit where
you can see the screen and say nothing.

## The ten-minute rule

During Level 4, do not help for the first ten minutes.

The exceptions are narrow: step in immediately if the participant is about to create data that
would have to be unpicked, or if they are distressed. Neither is common.

When ten minutes pass, or when the participant asks directly, write **ASSISTANCE REQUIRED** on the
sheet with the time and the exact words they used. Then help, minimally: point at the module, not
at the button.

Record the question they asked, not your answer. "Where do I raise a change?" and "Is this the
right project?" are different failures and the difference matters.

## What not to say

- Do not name the module unless you are giving assistance and recording it.
- Do not say "it's under Commercial" as encouragement. That is the answer.
- Do not narrate what they are doing. Silence is the instrument.
- Do not defend the product. If somebody says a screen is confusing, write it down and thank them.
  Explaining why it makes sense teaches them to stop telling you things.
- Do not tell them what a record is called. Whether they can find the right one is the test.

Saying "keep going", "take your time", or "there is no wrong answer" is fine. None of it tells
them anything about OctaPM.

## Telling user error from a product defect

By the end of the day you will have a list of moments where somebody could not do something. They
are not all the same thing, and the pilot decisions depend on sorting them correctly.

| What you saw | What it probably is |
| --- | --- |
| One person, once, and they laughed about it | Nothing. Do not log it. |
| Several people hesitate at the same screen | A usability defect |
| Everybody looks in the same wrong place first | The product's structure disagrees with the trade's |
| One person could not, everybody else could | Training gap for that person |
| Somebody did the wrong thing confidently | The most serious kind: the screen taught them something untrue |
| A control was not there at all | A missing feature, not a defect |
| It worked, but took eleven clicks | Inefficiency; record the count, not the feeling |

The last row on that list is why the sheets ask for clicks. "It felt slow" cannot be fixed.
"Fourteen clicks to raise an RFI" can.

## Classifying what you log

Every finding gets a severity and a kind.

**Severity.** P0 if the participant cannot safely operate the product. P1 if a core workflow cannot
be completed without help. P2 for significant confusion or wasted effort. P3 for polish.

**Kind.** Training gap, usability defect, product defect, permission problem, data problem, or a
documentation problem. A finding can only have one severity, but say plainly if you are unsure of
the kind: the triage afterwards is done by people who were not in the room.

Log to the defect register. One finding per entry, with the scenario, the role, what was expected
and what happened.

## Three things participants will ask about

These were found while the documentation was written. They are known, they are recorded, and they
are not new findings. Have the answers ready.

- **"Where is the button to raise a purchase order?"** There isn't one. An order comes from a
  procurement package, which comes from a material requirement on the programme. That is deliberate:
  every order traces back to a need. Record how long they looked before asking.
- **"It says something about a key and an index on the search screen."** That notice is for the
  system administrator. Search works without it.
- **"This notification is just a code."** Some items in the bell are named by an internal
  reference. Opening it shows the real record.

If a participant hits one of these, log it against the existing finding rather than as something
new. If they hit something that is not on this list, it is new, and it is exactly what you came for.

## Collecting feedback

Give out the feedback sheet at the end, not between exercises, and give people five quiet minutes
to fill it in. Do not collect it by going round the table: people soften what they write when the
trainer is standing over them.

The two questions that matter most are the last two. "What would stop you using OctaPM tomorrow"
gets you the blocker. "What did you like most" tells you what not to change.

## Resetting between sessions

The training organisation is rebuilt rather than tidied. Ask whoever set it up to run the reset
before the next group: it removes everything the last group created and puts the project back to
its starting state. Tidying by hand leaves half-finished records that confuse the next session
worse than a full reset ever costs.

Reset between groups, not between exercises. Level 3 depends on what Level 2 created, and Level 4
is more honest on a project with some history.

## Certifying a participant

At the end, decide one of three things for each person.

- **Certified for pilot.** Completed their scenarios, without help, and knew who held the next
  action.
- **Requires additional training.** Completed with help, or misunderstood a result.
- **Not yet certified.** Could not complete a core workflow for their role.

Write the reason. "Not yet certified" with no reason is useless to the person and to the pilot.

A participant who could not complete a scenario because the product has a defect is not
uncertified. Log the defect and certify them on the rest.
