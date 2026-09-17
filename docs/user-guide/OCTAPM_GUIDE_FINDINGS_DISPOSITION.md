# Product Findings — Disposition for Client Training and Pilot

Every finding recorded while the handbook was written is judged here against one question: what
does it do to a real person being trained on OctaPM, and to the pilot that follows. Nothing in the
product was changed to produce this document, and nothing here authorises a change.

Each finding carries exactly one disposition.

| Code | Disposition | Meaning |
| --- | --- | --- |
| **A** | Must fix before client training | A trainee would be misled or stopped by it. |
| **B** | Should fix before external pilot | Tolerable with a trainer present, not with a customer alone. |
| **C** | Can carry during pilot | Noted in the guide, no practical harm. |
| **D** | Documentation observation only | Nothing to fix in the product. |

## Summary

| Disposition | Count | Findings |
| --- | --- | --- |
| A — Must fix before client training | 1 | UG-09 |
| B — Should fix before external pilot | 9 | UG-01, UG-04, UG-07, UG-10, UG-13, UG-14, UG-16, UG-18, UG-19 |
| C — Can carry during pilot | 6 | UG-02, UG-03, UG-05, UG-11, UG-12, UG-17 |
| D — Documentation observation only | 2 | UG-06, UG-08 |
| **Total** | **18** | |

The register runs UG-01 to UG-19 with no UG-15: that number was never issued. The count is
eighteen findings, not nineteen.

Three of them decide how training is set up rather than what the product does. UG-09, UG-14 and
UG-16 all show archived or inactive records from earlier work. A training organisation created
clean, with one live project and no archived history, removes the symptom of all three without
touching the product. That preparation is assumed everywhere below.

---

## A — Must fix before client training

### UG-09 · Inactive companies in the demonstration Directory

| | |
| --- | --- |
| **Current type** | UX issue |
| **Affected persona** | Company administrator; anyone opening the Directory |
| **Affected workflow** | Company administration; supplier and subcontractor selection |
| **Client impact** | Sixty-one companies left over from earlier testing sit in the demonstration organisation as inactive rather than deleted. They appear the moment someone switches on "Show inactive companies". |
| **Training impact** | A trainee who switches the filter sees a register that looks abandoned, and loses confidence in every count on the screen. Selecting a party for a real exercise becomes guesswork. |
| **Pilot impact** | None in a customer's own organisation, which starts empty. |
| **Workaround** | Leave the inactive filter off, or run training on a clean organisation. |
| **Disposition** | **A — Must fix before client training** |
| **Recommended timing** | When the training organisation is prepared, before any participant signs in. This is a data task on the demonstration organisation, not a product change. |

---

## B — Should fix before external pilot

### UG-01 · No login for Client / Owner or Subcontractor

| | |
| --- | --- |
| **Current type** | Missing feature |
| **Affected persona** | Client / Owner, Subcontractor |
| **Affected workflow** | Project team, invitations, client valuations, subcontract pay applications |
| **Client impact** | Neither party can be given a login of their own. A representative invited to a project party receives an internal role and internal navigation, so there is no owner-facing or subcontractor-facing view and no boundary between what they see and what the contractor sees. |
| **Training impact** | Must be stated plainly at the start of training. A construction client will ask for owner access in the first session, and an answer of "not in this release" has to be ready rather than discovered. |
| **Pilot impact** | Decides the pilot's shape. An internal pilot is unaffected. A pilot that promises the owner a seat cannot be run on this release. |
| **Workaround** | The contractor's team issues valuations, certificates and reports from OctaPM and sends them out by the means already used. |
| **Disposition** | **B — Should fix before external pilot** |
| **Recommended timing** | Scoped as product work after the pilot decision, since it needs an external identity model and a tenant boundary, not a screen. |

### UG-04 · No way to raise a purchase order directly

| | |
| --- | --- |
| **Current type** | UX issue |
| **Affected persona** | Procurement |
| **Affected workflow** | Award → purchase order |
| **Client impact** | A purchase order is only created from a procurement package, which itself comes from a material requirement on the schedule. The Purchase Orders page has no "New purchase order" control, and its empty state explains the route instead. |
| **Training impact** | High. A buyer who knows exactly what to order will look for the button, not find it, and conclude the feature is missing. This is the most likely place for an independent exercise to stall. |
| **Pilot impact** | Buyers will ask for it in week one. The discipline it enforces (every order traced to a requirement) is defensible, but it has to be explained rather than discovered. |
| **Workaround** | Raise the requirement on the schedule, turn it into a package, then award. The workflow guide documents the whole path. |
| **Disposition** | **B — Should fix before external pilot** |
| **Recommended timing** | Before an external pilot, at minimum as a signpost from the Purchase Orders page to the package that would create one. |

### UG-07 · Two permissions worth a second look

| | |
| --- | --- |
| **Current type** | Permission inconsistency |
| **Affected persona** | QS / Commercial, Planner |
| **Affected workflow** | Progress approval; subcontract pay applications |
| **Client impact** | The QS may approve progress submissions, although progress is a planning matter. The Planner cannot open Pay Applications at all, although Commercial sits on the Planner's module bar. Both are exactly what the permission rules say, so neither is a defect, but together they will look wrong to a company that reads the matrix. |
| **Training impact** | Moderate. Trainees compare notes and notice. A trainer needs the answer that these are configurable company decisions, not fixed behaviour. |
| **Pilot impact** | A customer will want these set to their own delegation of authority before they trust approvals. |
| **Workaround** | None needed; the rules work as written. |
| **Disposition** | **B — Should fix before external pilot** |
| **Recommended timing** | Review with the customer's company administrator when the pilot's permission template is agreed. |

### UG-10 · Schedule documented from earlier evidence

| | |
| --- | --- |
| **Current type** | Documentation evidence gap |
| **Affected persona** | Planner; Project Manager |
| **Affected workflow** | Programme, progress, critical path, lookahead |
| **Client impact** | None observed. The module was certified in an earlier phase and its chapter is written from the live screens and that evidence, not from a fresh end-to-end run. |
| **Training impact** | The Planner's exercises rest on the thinnest evidence of any role. If the module has moved since it was certified, the Planner's session is where it will surface. |
| **Pilot impact** | Schedule is the spine of the product. Carrying an unvalidated spine into a customer pilot is the larger risk here. |
| **Workaround** | Run the Planner's exercises first in any training session, with a trainer present. |
| **Disposition** | **B — Should fix before external pilot** |
| **Recommended timing** | A fresh validation pass on Schedule before the pilot; no product change implied. |

### UG-13 · The notification bell names records by an internal reference

| | |
| --- | --- |
| **Current type** | UX issue |
| **Affected persona** | Every role |
| **Affected workflow** | Notifications; picking up work |
| **Client impact** | Some items in the bell are named by an internal reference rather than by their title: a change-order approval reads as a code, and a bill-of-quantities allocation shows a long identifier. |
| **Training impact** | Direct. Notifications are taught in the first ten minutes, and an item nobody can read teaches the wrong lesson about whether the system is finished. |
| **Pilot impact** | People act on notifications daily. An unreadable one is either ignored or opened blind. |
| **Workaround** | Open the item; the record itself is named correctly. |
| **Disposition** | **B — Should fix before external pilot** |
| **Recommended timing** | Before an external pilot. Raw identifiers in front of ordinary users are the single most visible sign of unfinished software. |

### UG-14 · Tasks and People count archived projects

| | |
| --- | --- |
| **Current type** | UX issue |
| **Affected persona** | Every role; most visible to administrators |
| **Affected workflow** | Global task list; people administration |
| **Client impact** | The global Tasks page lists tasks belonging to archived projects, and the People page counts archived projects in a person's project total, so a person can appear to be on a hundred and fourteen projects. |
| **Training impact** | Only where archived projects exist. A clean training organisation has none. |
| **Pilot impact** | Grows through the pilot: the first archived project makes every global count wrong. |
| **Workaround** | Work from the project's own task list rather than the global one. |
| **Disposition** | **B — Should fix before external pilot** |
| **Recommended timing** | Before a customer archives their first project. |

### UG-16 · Global inventory views include archived projects

| | |
| --- | --- |
| **Current type** | UX issue |
| **Affected persona** | Storekeeper; Procurement; Cost Controller |
| **Affected workflow** | Three-way match; inventory dashboard; warehouses |
| **Client impact** | The Match, Dashboard and Warehouses views list movements, orders and stores from archived projects, including names left over from earlier testing. The Items tab and goods receipts are clean. |
| **Training impact** | Only where archived projects exist, as above. |
| **Pilot impact** | The three-way match is a financial control. A match screen that mixes in archived projects will be questioned by anyone checking it. |
| **Workaround** | Filter to the live project, or work from the Items tab and the receipts. |
| **Disposition** | **B — Should fix before external pilot** |
| **Recommended timing** | With UG-14; they are the same omission in two places. |

### UG-18 · The Security page shows internal role identifiers

| | |
| --- | --- |
| **Current type** | UX issue |
| **Affected persona** | Company administrator |
| **Affected workflow** | Security and access administration |
| **Client impact** | People are listed against the internal form of their role rather than the label used everywhere else in the product, so the same role is named two different ways in two places. |
| **Training impact** | Confined to the administrator's session, but that is the session where trust in the access model is either won or lost. |
| **Pilot impact** | An administrator assigning access should never have to translate. |
| **Workaround** | The Permissions page and the Directory use the proper labels. |
| **Disposition** | **B — Should fix before external pilot** |
| **Recommended timing** | Before an external pilot; a label change, not a model change. |

### UG-19 · Server-configuration wording on two screens

| | |
| --- | --- |
| **Current type** | Documentation only, reclassified here as a user-facing wording issue |
| **Affected persona** | Site Engineer; anyone searching documents |
| **Affected workflow** | Document search; daily log |
| **Client impact** | Document search carries a notice about a missing key and a missing index, and the daily log says no assistant is configured on the server. Both features work without any of it: search finds text, and the log is written by hand. |
| **Training impact** | High for its size. A trainee reads an instruction addressed to a system administrator and assumes the feature is broken or that they have done something wrong. |
| **Pilot impact** | Generates support questions that have no answer the user can act on. |
| **Workaround** | The trainer explains that these notices are for the administrator and that the features work regardless. |
| **Disposition** | **B — Should fix before external pilot** |
| **Recommended timing** | Before an external pilot: either configure the services, or word the notice for the person actually reading it. |

---

## C — Can carry during pilot

### UG-02 · The supplier portal confirms a withdrawal with the browser's own dialog

| | |
| --- | --- |
| **Current type** | UX issue |
| **Affected persona** | Supplier / Bidder |
| **Affected workflow** | Bid submission and withdrawal |
| **Client impact** | The confirmation is the browser's plain dialog rather than the product's own, so one moment of an otherwise branded flow looks unfinished to an outside company. |
| **Training impact** | Minimal; suppliers are not trained. |
| **Pilot impact** | Cosmetic, though it is seen by people outside the customer's organisation. |
| **Workaround** | None needed; the dialog works. |
| **Disposition** | **C — Can carry during pilot** |
| **Recommended timing** | With the next pass over the portal. |

### UG-03 · Quick actions offer nothing to three roles

| | |
| --- | --- |
| **Current type** | UX issue |
| **Affected persona** | Procurement, Storekeeper, Finance |
| **Affected workflow** | Starting work from Workspace Control |
| **Client impact** | None of the four quick actions is a record these roles create, so the block does not appear for them. |
| **Training impact** | Small, and handled: their handbooks start from the module bar rather than from quick actions. |
| **Pilot impact** | These roles reach their work in one more click than the others. |
| **Workaround** | The module bar, which is where their work lives anyway. |
| **Disposition** | **C — Can carry during pilot** |
| **Recommended timing** | Whenever quick actions are next revisited; worth pairing with UG-04. |

### UG-05 · Company registries have no pagination or audit view

| | |
| --- | --- |
| **Current type** | Documentation only |
| **Affected persona** | Company administrator |
| **Affected workflow** | Directory, vendors, cost codes, equipment, templates |
| **Client impact** | The registries search and filter but do not page, and they show no history of who changed an entry. |
| **Training impact** | None at demonstration volumes. |
| **Pilot impact** | Appears once a customer loads a real supplier list. Search carries the load until then. |
| **Workaround** | Search and filter. |
| **Disposition** | **C — Can carry during pilot** |
| **Recommended timing** | When a customer's own data volume makes it real. |

### UG-11 · One refused request behind the Site Engineer's Commercial tab

| | |
| --- | --- |
| **Current type** | UX issue |
| **Affected persona** | Site Engineer |
| **Affected workflow** | Opening Commercial |
| **Client impact** | None visible. The page opens on Change Events, the one tab the role may read, and works; behind it the page also asks for the commitment register, which the rules refuse. |
| **Training impact** | None. Nothing appears on screen. |
| **Pilot impact** | None functional. |
| **Workaround** | Not required. |
| **Disposition** | **C — Can carry during pilot** |
| **Recommended timing** | Housekeeping, whenever Commercial is next touched. |

### UG-12 · The notifications address is not a page

| | |
| --- | --- |
| **Current type** | UX issue |
| **Affected persona** | Every role |
| **Affected workflow** | Notifications |
| **Client impact** | Typing the notifications address reaches a "Page Not Found" screen. Notifications live in the bell in the top bar and, for preferences, under Settings. Nothing in the product links to the address that fails. |
| **Training impact** | Only for someone who guesses at addresses. The guide sends people to the bell. |
| **Pilot impact** | Low. |
| **Workaround** | The bell, and Settings → Notifications. |
| **Disposition** | **C — Can carry during pilot** |
| **Recommended timing** | Either redirect the address to the bell or leave it; no user path leads there. |

### UG-17 · Vendors shows inactive entries by default

| | |
| --- | --- |
| **Current type** | UX issue |
| **Affected persona** | Company administrator; Procurement |
| **Affected workflow** | Vendor administration |
| **Client impact** | The Vendors tab lists inactive vendors without being asked, while the Directory hides them unless asked. The same idea behaves two ways in one workspace. |
| **Training impact** | Small on a clean organisation. |
| **Pilot impact** | Low, and it lessens once UG-09's data is cleaned. |
| **Workaround** | Read the status column. |
| **Disposition** | **C — Can carry during pilot** |
| **Recommended timing** | With UG-09, since both concern what a registry shows by default. |

---

## D — Documentation observation only

### UG-06 · Run-stamped party names in the certified project

| | |
| --- | --- |
| **Current type** | Documentation only |
| **Affected persona** | Anyone opening the certified project's Directory |
| **Affected workflow** | None |
| **Client impact** | The parties of the frozen certification project carry names stamped with the run that created them. The project is kept read-only as evidence, by design. |
| **Training impact** | None: training and every screenshot use Riverside Tower instead. |
| **Pilot impact** | None. |
| **Workaround** | Not applicable. |
| **Disposition** | **D — Documentation observation only** |
| **Recommended timing** | Leave as it is. Changing it would destroy the evidence it exists to preserve. |

### UG-08 · Budget and bill of quantities differ on the demonstration project

| | |
| --- | --- |
| **Current type** | Documentation only |
| **Affected persona** | QS / Commercial; Cost Controller |
| **Affected workflow** | Budget from bill of quantities |
| **Client impact** | The demonstration project's budget does not equal its bill of quantities total, so the Budget tab shows the difference as an "off by" note. The note is the product working correctly on figures that were seeded apart. |
| **Training impact** | Useful, in fact: it shows the reconciliation the product performs. The screenshot caption says as much. |
| **Pilot impact** | None. |
| **Workaround** | Not applicable. |
| **Disposition** | **D — Documentation observation only** |
| **Recommended timing** | None. Optionally seed the demonstration figures to agree, if a trainer would rather not explain it. |

---

## What this means for the training kit

- **Say it first.** Client / Owner and Subcontractor have no login (UG-01). Every participant should
  hear this in the welcome, not discover it.
- **Prepare the organisation.** A clean training organisation with one live project and no archived
  history removes UG-09, UG-14 and UG-16 from the room entirely.
- **Brief the trainer on three screens.** Document search and the daily log carry notices meant for
  administrators (UG-19), and the notification bell names some items by a code (UG-13). All three
  invite the question "is this broken?" The answer is no, and the trainer should have it ready.
- **Watch the purchase order exercise.** UG-04 is where an independent participant is most likely to
  stall. It is the finding worth measuring rather than explaining away: if a buyer cannot find the
  route unaided, that is evidence, not a training failure.
