# OctaPM Training and UAT Workbook

This is not another manual. It is a workbook: a set of things to do in OctaPM, in order of
difficulty, ending with work nobody is allowed to help you with.

The difference matters. A manual tells you where to click. A workbook finds out whether you could
have worked it out. By the end of Level 4 we should know something we cannot learn from any
automated test: whether a construction professional, given a job to do and no instructions, can do
it in OctaPM.

Everything here refers only to what the product does today. Where a role cannot do something, the
exercise says so rather than pretending.

## How the four levels work

| Level | What you are given | What we learn |
| --- | --- | --- |
| 1 — Guided onboarding | Every step, in order | That you can sign in and move around |
| 2 — Role practice | The task, and the module it lives in | That you can work your own records |
| 3 — Connected scenarios | A business objective and a handoff | That work reaches the next person |
| 4 — Independent | A situation and a result to reach | Whether the product explains itself |

Levels 1 and 2 are trained. Level 3 is run as a team, with the trainer watching rather than
helping. Level 4 is measured, and help is recorded as evidence.

## Before you start

- You have been sent a sign-in address, an email address and a first password.
- You have been told your role for the session. It decides what you can see.
- Client / Owner and Subcontractor are not roles in this release. If you represent one of those
  parties in real life, you will be given an internal role for the exercises.
- Use the training organisation only. Nothing you do there affects a live project.

---

# Level 1 — Guided onboarding

Follow these exactly. They take about twenty minutes and everyone does them, whatever their role.

## 1.1 Sign in

1. Open the OctaPM address you were sent.
2. Enter your email address and password.
3. Select **Sign in**.
4. You arrive on Workspace Control.

**What to notice.** The page you land on is your workspace, not a project. OctaPM starts from what
is waiting on you, not from a file tree.

## 1.2 Read Workspace Control

1. Read the **Official KPIs** across the top.
2. Find **My open items**. This is your Needs You list.
3. Find **Pending review** and notice that it is kept apart from the official figures.
4. If your role has a **Quick actions** block, read what it offers. Three roles have none, because
   none of the quick actions is a record they create.

**Write down.** How many items are waiting on you? _______

## 1.3 Select a project

1. Select **Select project** in the top bar.
2. Choose the training project.
3. Read the project header: name, dates, contract value, status.
4. Read the **module bar** and open **More** to see the rest.

**Write down.** Which modules can you see? _______________________________________

## 1.4 Open a record from Needs You

1. Return to Workspace Control.
2. Open one item from **My open items**.
3. Notice that you land on the record with the control you need already in front of you.
4. Do not act on it yet. Come back to Workspace Control.

## 1.5 Use a quick action, then abandon it

1. If you have a **Quick actions** block, select one of the actions.
2. Notice the **In project…** control: quick actions remember a project per browser.
3. Close the form without saving.

## 1.6 Search

1. Press **Ctrl+K**, or select **Search** in the top bar.
2. Type the name of the training project.
3. Open it from the results.

## 1.7 Open a record by its address

1. Open any record and copy the address from the browser.
2. Open a new tab and paste it.
3. The record opens directly. Every register, tab and record in OctaPM has its own address.

## 1.8 Notifications

1. Select the **bell** in the top bar.
2. Read what changed on records you follow.
3. Open your account menu and find **Settings → Notifications** to see which events reach you.

There is no separate notifications page in this release. The bell is the list.

## 1.9 Sign out

1. Open the account menu, top right.
2. Select **Sign out** and confirm.

---

# Level 2 — Role practice

Do the exercises for your own role. You are told which module to work in, but not which button to
press. If you cannot find something after a few minutes, say so: that is useful evidence, and the
trainer will record it before helping.

## Project Manager

1. Read the project's health: the seven-dimension score and what sits behind it.
2. Clear your Needs You list: answer, approve or reject whatever is waiting.
3. Open a change order that is awaiting approval and decide it.
4. Open an RFI that has been answered and close it with a decision note.
5. Read the commercial position: committed, actual, forecast.

## Planner

1. Open the programme and find the critical path.
2. Record progress on one activity.
3. Check what moved: earned value, the health score, the activity's status.
4. Read the lookahead.
5. Find the long-lead items and check their dates against the programme.

## QS / Commercial

1. Raise a change order against a named budget line, with a reason and evidence.
2. Submit it for approval and note who it goes to.
3. Open the commitment register and read what is committed against what.
4. Open a pay application and certify the value you agree with.
5. Check the client valuation position.

## Cost Controller

1. Read the budget: original, revised, and what moved it.
2. Read actual cost and open one entry to see where it came from.
3. Read the forecast and the estimate at completion.
4. Find the largest variance and work out what caused it.

## Procurement

1. Create a bid package from a material requirement.
2. Invite suppliers to it.
3. Compare the bids you receive.
4. Award one, and find the purchase order that follows the award.

A purchase order is raised from a package, not from the Purchase Orders page. If you look for a
"new purchase order" button and cannot find one, that is expected. Tell the trainer.

## Storekeeper

1. Receive a delivery against a purchase order.
2. Check what the receipt did to stock on hand.
3. Issue material to an activity.
4. Read the inventory ledger and find the issue you just made.

## Site Engineer

1. Write a daily log for today.
2. Raise an RFI with a clear question, assigned to the right person.
3. Record progress on the activity you worked on.
4. Request material for tomorrow's work.

## Quality Engineer

1. Raise an inspection against an activity.
2. Record the result. If it fails, raise a non-conformance.
3. Assign the non-conformance to the responsible party.
4. Approve a closeout that has been submitted to you.
5. Add a punch item.

## Finance

1. Open a supplier invoice and check it against the order and the receipt.
2. Record a payment.
3. Read the cash-flow position.
4. Find what is owed and what is owing.

## Supplier / Bidder

You work from the invitation link, not from a login.

1. Open the invitation you were sent.
2. Read the package: what is wanted, and by when.
3. Price the lines.
4. Ask a question about the package.
5. Submit your bid, then withdraw it and change one price.

---

# Level 3 — Connected team scenarios

These are run with several people at once. Each participant is told the situation, the objective
and who they hand to. Nobody is told which buttons to press.

The point is the handoff. A scenario passes when the work reaches the next person without anybody
telling them it is there.

## UAT-01 · RFI lifecycle

| | |
| --- | --- |
| **People** | Site Engineer, the person asked (Project Manager), Site Engineer again |
| **Starting condition** | A live project with a programme |
| **Objective** | Get a formal written answer to a site question, on the record |
| **Handoff** | Site Engineer → assignee → back to Site Engineer → Project Manager closes |
| **Passes when** | The answer is on the record, the RFI is closed, and the Site Engineer saw it without being told |

## UAT-02 · RFI leading to a change

| | |
| --- | --- |
| **People** | Site Engineer, QS, Project Manager |
| **Starting condition** | UAT-01 complete, with an answer that changes the work |
| **Objective** | Turn the answer into a priced change against the right budget line |
| **Handoff** | Site Engineer → QS raises the change citing the RFI → PM approves |
| **Passes when** | The change carries the RFI as evidence and the revised budget moves |

## UAT-03 · RFQ to bid to award to purchase order

| | |
| --- | --- |
| **People** | Site Engineer or Planner, Procurement, two Suppliers |
| **Starting condition** | A material requirement on the programme |
| **Objective** | Buy the material from the better of two quotes |
| **Handoff** | requirement → package → suppliers price → Procurement awards → order issued |
| **Passes when** | The order exists, names the winning supplier, and is committed against the budget |

## UAT-04 · Order to receipt to stock to issue to cost

| | |
| --- | --- |
| **People** | Storekeeper, Site Engineer, Cost Controller |
| **Starting condition** | UAT-03 complete |
| **Objective** | Get the material on site, into stock, out to the work, and into the cost |
| **Handoff** | delivery → receipt → stock → issue to an activity → actual cost |
| **Passes when** | The Cost Controller finds the cost without being told which activity |

## UAT-05 · Timesheet to labour cost

| | |
| --- | --- |
| **People** | Site Engineer, Project Manager, Cost Controller |
| **Starting condition** | Work recorded against an activity |
| **Objective** | Get a week's labour into the cost of the right activity |
| **Handoff** | hours recorded → approved → actual cost |
| **Passes when** | The labour cost appears against the activity and in the forecast |

## UAT-06 · Pay application to certification to payment

| | |
| --- | --- |
| **People** | QS, Project Manager, Finance |
| **Starting condition** | A subcontract commitment with work done against it |
| **Objective** | Pay a subcontractor for the work you agree they have done |
| **Handoff** | application → certification → actual cost → payment → cash flow |
| **Passes when** | The certified value and the paid value agree, and cash flow reflects it |

## UAT-07 · Change to revised budget to forecast

| | |
| --- | --- |
| **People** | QS, Project Manager, Cost Controller |
| **Starting condition** | An approved change order |
| **Objective** | Show what the change did to the money |
| **Handoff** | approval → revised budget → forecast → reports |
| **Passes when** | The Cost Controller can explain the movement from the record alone |

## UAT-08 · Inspection to non-conformance to closeout

| | |
| --- | --- |
| **People** | Quality Engineer, the responsible party, Quality Engineer |
| **Starting condition** | Work ready to inspect |
| **Objective** | Fail an inspection, get the work corrected, and close it properly |
| **Handoff** | inspection → non-conformance → assignee corrects and submits → approval |
| **Passes when** | The non-conformance is closed by the Quality Engineer, not by the person who fixed it |

## UAT-09 · Meeting to action to task

| | |
| --- | --- |
| **People** | Project Manager, two others |
| **Starting condition** | A meeting to hold |
| **Objective** | Turn a decision in a meeting into work somebody owns |
| **Handoff** | meeting minuted → action with an owner → the owner's list |
| **Passes when** | Each owner finds their action without being sent a link |

## UAT-10 · Document and submittal review

| | |
| --- | --- |
| **People** | Site Engineer or Planner, reviewer, Project Manager |
| **Starting condition** | A drawing or specification to issue |
| **Objective** | Get a document reviewed and its status settled |
| **Handoff** | upload → review requested → reviewed → status recorded |
| **Passes when** | The current version is obvious to somebody who was not involved |

---

# Level 4 — Independent certification

No click-by-click guidance. No module named. You are given a situation and a result to reach.

The trainer will not help for the first ten minutes unless you are about to create data that would
be wrong to keep. If you ask where to click, that is written down before you are answered. It is
not a mark against you: it is the measurement.

## IND-01 · Site Engineer

**Background.** A drawing detail affecting tomorrow's concrete pour is unclear. The opening
dimension is not shown properly and the gang starts at seven.

**Objective.** Use OctaPM to get a formal answer from the person responsible, and make sure the
issue is visible to the project team rather than sitting in your inbox.

**Success.** The right kind of record exists, on the right project, assigned to the right person;
the answer is recorded; the status is clear to a stranger; the trail shows who did what.

**Time target.** 10 minutes.

## IND-02 · Project Manager

**Background.** The client has asked why the project is forecast to finish over budget.

**Objective.** Answer them from OctaPM, with the figures and the records behind them.

**Success.** You can name the movement, show the approved changes behind it, and point to the
records rather than to a spreadsheet.

**Time target.** 12 minutes.

## IND-03 · QS / Commercial

**Background.** A site instruction has added blockwork that was never in the bill of quantities.

**Objective.** Get the extra work priced, evidenced and into the budget through the proper route.

**Success.** A change exists against the right budget line, with evidence attached, submitted to
the person who decides; the revised budget moves only after that decision.

**Time target.** 12 minutes.

## IND-04 · Procurement

**Background.** Reinforcement is needed on site in three weeks and nothing has been ordered.

**Objective.** Get it bought from a supplier you have compared against at least one other.

**Success.** An order exists, traceable back to the requirement and to the quotes you compared.

**Time target.** 15 minutes.

## IND-05 · Storekeeper

**Background.** A lorry is at the gate with material against an order, and the site wants half of
it this morning.

**Objective.** Take the delivery onto the system and get the half that is wanted out to the work.

**Success.** Stock rose by what arrived and fell by what was issued; the issue is attached to an
activity; the cost followed.

**Time target.** 10 minutes.

## IND-06 · Quality Engineer

**Background.** A pour has been finished to the wrong cover depth in one bay.

**Objective.** Record it, get it put right by whoever is responsible, and close it yourself.

**Success.** A non-conformance exists against the right party, corrective action is recorded, and
closure was done by you rather than by the person who did the work.

**Time target.** 12 minutes.

## IND-07 · Cost Controller

**Background.** Actual cost on the substructure is running ahead of the budget and nobody knows
why.

**Objective.** Find out what is driving it, from the records.

**Success.** You can name the largest contributors and open the records behind them.

**Time target.** 10 minutes.

## IND-08 · Planner

**Background.** The programme has slipped and the client wants to know whether the completion date
is still real.

**Objective.** Show the current critical path and what is driving the slip.

**Success.** The critical path is identified, the driving activities are named, and the schedule
performance figure agrees with what you are saying.

**Time target.** 12 minutes.

## IND-09 · Finance

**Background.** A supplier is chasing payment and says they delivered three weeks ago.

**Objective.** Establish whether they are owed the money, and settle it if they are.

**Success.** You checked the invoice against the order and the receipt before paying, and the cash
position reflects what you did.

**Time target.** 10 minutes.

## IND-10 · Administrator

**Background.** A new quantity surveyor starts on Monday and needs to work on one project only.

**Objective.** Get them set up so that they can do their job on that project and nothing else.

**Success.** The person exists, holds the right role, is on the right project team, and cannot
reach projects they are not on.

**Time target.** 10 minutes.

---

# Observation sheet

One of these is completed by the observer for every Level 4 scenario. Fill it in during the
exercise, not afterwards.

| Field | Record |
| --- | --- |
| Participant | |
| Role | |
| Scenario | |
| Date and time | |
| Completed successfully | YES / NO |
| Completed without help | YES / NO |
| Time taken | |
| Clicks to first correct screen | |
| Wrong modules opened | |
| Times the participant went back | |
| Verbal help needed | YES / NO — what was asked |
| Records created in error | |
| Participant understood the result | YES / NO |
| Participant knew who had the next action | YES / NO |
| Confidence, 1 to 5 | |
| Difficulty, 1 to 5 | |
| Observer notes | |

**How to count clicks.** Count from Workspace Control to the first screen where the participant
could actually do the task. Stop counting there. What matters is how long the product takes to
show somebody where their work lives.

**What counts as help.** Anything that tells the participant where to go. Saying "keep going" is
not help. Saying "try Commercial" is.

---

# Pass criteria for the pilot

These are the targets a Pilot-UAT round is measured against. They are recommendations, not a
certificate: a product is not ready for people because it passed its own tests.

| Measure | Target |
| --- | --- |
| Scenarios completed | 90% or better |
| Critical workflow errors | 0 |
| Financial or data-integrity errors | 0 |
| Participants finishing without assistance | 85% or better |
| Participants who knew who held the next action | 90% or better |
| Average confidence | 4 out of 5 or better |
| Severe usability blockers | 0 |

A round that misses one target is not a failure: it is a list of what to fix. A round that misses
the two zeros is, and should stop the pilot until the cause is understood.

## What we already expect to see

Three things were found while the documentation was written, and they are worth watching for
rather than being surprised by.

- **The purchase order route.** There is no button that raises one directly. Procurement
  participants are likely to search for it. Record how long they search before finding the route
  through a package.
- **Wording meant for administrators.** Document search and the daily log carry notices about
  server configuration. Participants may read these as errors.
- **Notification wording.** Some items in the bell are named by an internal reference rather than
  by their title.

If participants stumble on these, the finding is confirmed, not new. Record it against the
existing identifier rather than raising a duplicate.
