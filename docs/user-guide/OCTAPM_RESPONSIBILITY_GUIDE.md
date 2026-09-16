# OctaPM Responsibility and Handoff Guide

OctaPM keeps one answer to the question "whose move is it?" on every record, and moves that answer
as the record moves. This guide explains the words the product uses and how responsibility passes
from person to person.

## The words

| Term | Meaning | Where you see it |
| --- | --- | --- |
| **Needs You** (My open items) | The records waiting on you today: you are the owner, reviewer, approver or assignee, or you hold the ball. Matched to your account, not to your name. | Workspace Control, second block |
| **Ball in Court** | The one person whose action the record is waiting for right now, with what they are expected to do. | Every register row ("Awaiting the QS — to be sent for approval"), record headers |
| **Owner** | The person accountable for the record end to end. Usually the person who raised it. | Record header, RFI and submittal details |
| **Creator** | The person who first saved the record. Recorded in the audit history; often the same as the owner. | Audit history |
| **Assignee** | The person asked to do the next piece of work: answer the RFI, fix the NCR, receive the delivery. | Record header, Needs You |
| **Reviewer** | A person asked to check a record before it is decided. | Submittals, RFIs with review steps |
| **Approver** | The person who decides: approve, reject, certify, close. Defined by role and, on some records, by the workflow set for the project. | Approval queues, Needs You |
| **Responsible company** | The company answerable for the record, beside the responsible person. | NCRs, punch items, safety incidents, RFIs with a party |

## How responsibility moves

The ball moves when a record changes state. Each move creates a Needs You item for the next person
and removes it from the previous one, without a refresh.

**RFI**

```
Site engineer raises  →  ball: the assignee (design lead or PM) — to answer
Assignee answers      →  ball: the owner — to accept and close
Owner closes          →  nobody holds it; it stays on record
```

**Change order**

```
QS drafts             →  ball: the QS — to add proof and submit
QS submits            →  ball: the PM — to approve or disapprove
PM approves           →  nobody holds it; budget, forecast and reports update
PM disapproves        →  ball: the QS — to revise and resubmit
```

**Purchase order**

```
Procurement drafts    →  ball: procurement — to send for approval
Sent for approval     →  ball: the PM — to approve
Approved and issued   →  ball: the supplier — to acknowledge
Delivered             →  ball: finance — the supplier's invoice
Invoiced and matched  →  closed
```

**Subcontractor pay application**

```
Draft                 →  ball: the subcontractor — to submit the claim
Submitted             →  ball: the QS — to certify
Certified (approved)  →  ball: finance — to pay
Paid                  →  nobody holds it
```

**NCR**

```
Quality engineer raises →  ball: the assignee (responsible person) — corrective action
Assignee submits closeout with evidence →  ball: the quality engineer — to approve or reject
Approved              →  closed
Rejected              →  ball: the assignee — to redo the corrective action
```

**Progress submission**

```
Site engineer submits →  ball: the planner or PM — to approve
Approved              →  earned value and dashboards update
```

## Rules to know

- **The assignee can always act.** The person an NCR or safety incident is assigned to can submit
  its closeout whatever their role. Approval stays with the quality engineer.
- **Approvals follow roles.** Only roles with the approval right see the Approve button. A person
  without it sees the record, its status and who holds it, but no control.
- **Needs You is personal.** Two people with the same name do not share items; the match is on the
  account.
- **Closing clears the queue.** When a record closes, it leaves Needs You for everyone who held it.
- **Every move is recorded.** The audit history names the person, the action and the time; approvals
  record the approver.

## Handoff table

| When this happens | Who receives it | What they see |
| --- | --- | --- |
| An RFI is raised | the assignee | Needs You item, RFI register row "Awaiting …" |
| An RFI is answered and closed | the owner, the raiser | register row "Closed" in both sessions |
| A change order is submitted | the PM | approval queue on the register ("1 pending"), Needs You |
| A change order is approved | the QS, cost control | register "Approved"; Cost Overview and Budget carry the value |
| A goods receipt is posted | procurement, the PM | Purchase Orders "Delivered"; stock on hand updated |
| A pay application is certified | finance | pay application "Awaiting finance — payment" |
| An NCR is raised | the responsible person | Needs You item, Quality dashboard row with "Submit closeout" |
| A closeout is submitted | the quality engineer | NCR "submitted" with Approve and Reject |
| A closeout is approved | the responsible person | NCR "closed"; it leaves their Needs You |
