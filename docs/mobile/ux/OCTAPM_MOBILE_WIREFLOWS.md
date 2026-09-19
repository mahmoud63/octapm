# OctaPM Mobile — Wireflows

**Audience:** whoever implements UX2-B through UX2-I, and the observer running the §73 user-flow test.
**Date:** 2026-09-19. **Status:** design. Each flow names the screens, the taps and the server call, and ends where the office sees the result.

Notation: `→` a navigation, `⊕` a capture point, `⇨` what reaches the office.

## 1. PM morning (§7, §8)

```
open app → PM HOME (one project, named)
  reads: /health · /forecast · /cost/summary · /daily-logs/today · /photos · assignments
  ├ "4 approvals"        → NEEDS YOU ▸ Approvals → APPROVAL DETAIL
  │                         sees change value, reason, programme, evidence, prior answers
  │                         Approve → confirmation naming the record and the money
  │                         ⇨ record transitions · audit · next approver notified
  ├ "2 overdue RFIs"     → NEEDS YOU ▸ Overdue → RFI DETAIL → chase or answer
  ├ PROJECT PULSE        → CONTROLS → Schedule ▸ critical driver → ACTIVITY DETAIL
  ├ "TODAY ON SITE"      → DAILY REPORT (read-only) → section → entries
  └ RECENT PHOTOS        → PHOTO VIEWER → Open related record
```
Success test: the PM can state today's decisions, the schedule and cost position, and what happened on site, without a laptop.

## 2. Site engineer's day (§9–§11)

```
arrive → TODAY
  ├ TODAY'S WORK ▸ A-2000 → ACTIVITY DETAIL
  │    ├ Open drawing        → DRAWING DETAIL (rev C, superseded warning if older)
  │    ├ Update progress ⊕   → % + quantity + note + photo
  │    │                       ⇨ progress_submission · activity actual · SPI · PM Needs You
  │    ├ Raise RFI ⊕         → prefilled activity, location, drawing  ⇨ RFI · ball in court
  │    ├ Request material    → issue request against this activity
  │    └ Report delay ⊕      → cause, duration, responsible  ⇨ daily log delays · EOT exposure
  ├ BLOCKING → RFI-034 → chase
  ├ INSPECTIONS DUE → INSPECTION → answer → sign ⊕
  └ end of shift → DAILY REPORT → manpower · plant · deliveries · delays · photos → Submit
       ⇨ site reporting · PM home "today on site" · web dashboard
```
Success test: one full shift, gloves on, without asking anyone where to tap.

## 3. Capture, from anywhere (§15–§18)

```
[ ⊕ Capture ] (centre slot, field roles)
  → sheet, role- and permission-filtered
     Site photo · Progress · Daily log · RFI · Punch · NCR · Safety · Inspection · Goods in · Task
  → camera / library
  → CONTEXT IS INHERITED, never typed:
       project · location (from the screen you stood on) · record (if you were in one)
       · time · photographer · optional caption and tags
  → "Photo on NCR-012 · Level 04 · Zone B"       ← the sheet states what it will record
  → offline? queue, thumbnail visible, WAITING TO UPLOAD
  ⇨ ProjectDocument + Attachment (on the record) + Photo (in the gallery, located)
  ⇨ web: the record's evidence tab AND the project gallery AND latest-photos
```

## 4. Inspection → NCR → closeout (§33)

```
INSPECTIONS → INSPECTION DETAIL → answer items → a FAIL
  → "Raise NCR from this item"  (carries inspection, location, activity, evidence)
  → NCR DETAIL: severity, responsible company, assignee, due
     ⇨ assignee notified · quality dimension moves
  ...responsible party closes out ⊕ evidence
  → quality engineer reviews → Approve closeout        ← only this role may
     ⇨ NCR closed · quality score · audit
```

## 5. Storekeeper (§31, §32)

```
HOME → deliveries expected today
  → SCAN (PO label) → DELIVERY DETAIL
     → receive line by line: accepted / rejected / damaged ⊕ photo + delivery note
     ⇨ InventoryMovement · PO outstanding qty · procurement view
  ISSUE → scan item → quantity → **against an activity**
     ⇨ InventoryMovement · COST LEDGER · activity actual · cost KPI
        (weighted average cost; qty negative, value positive; lands on `actual`)
```
Financial gate: expected = SQL = API = web = mobile, delta 0.00, one ledger row, one movement.

## 6. Change event → decision (§29, §59)

```
site or QS raises CHANGE EVENT ⊕ evidence
  ⇨ commercial register (immediate, same record)
QS prices it → change order submitted
  ⇨ workflow starts → PM NEEDS YOU
PM → APPROVAL DETAIL → value, reason, programme, cost impact, evidence, prior answers
  → Approve  ⇨ change order approved · commercial position · audit
```

## 7. Locations (§12)

```
LOCATIONS (tree: site ▸ building ▸ level ▸ zone ▸ room)
  → LOCATION DETAIL ▸ Level 04 ▸ Zone B
       Photos · Drawings(sheets) · RFIs · Punch · Inspections · Change events
       · Lookahead items · Deliveries        ← all carry locationId today
       Activities / NCRs / Tasks / Materials  ← NOT linked to location; derived or omitted
     actions: Take photo here ⊕ · Raise RFI here · Punch here · Inspect here · Task here
```
Empty-state honesty: the certified project has **zero** locations. The screen explains how locations are created rather than showing a blank tree.

## 8. Office → field (§24)

```
web assigns a task      ⇨ push → NEEDS YOU → TASK DETAIL → Complete ⇨ web state
web answers an RFI      ⇨ push → the open RFI shows the official answer (measured 972 ms)
web assigns an NCR      ⇨ push → NCR list (901 ms)
web issues a PO         ⇨ storekeeper's deliveries view
web publishes a drawing ⇨ register updates; the older revision is marked superseded
```

## 9. Offline (§47, §48)

```
signal lost → bar: OFFLINE · showing saved project data · 3 changes waiting
  capture, progress, punch, inspection, daily log, timesheet → queue (replay key)
  stock moves and approvals → refused with a sentence: these need a connection
  → SYNC CENTER: saved · pending · syncing · failed · conflict, each in words
signal returns → drains in order; a photo goes against the id its record's send returned
  → failures keep the local file and offer Retry / Discard, and say why
```

## 10. The §73 questions these flows must answer

Can a site engineer run one shift from mobile? Can a PM understand the project without a laptop? Can quality run inspection → NCR → closeout? Can a storekeeper receive and issue? Does field evidence reach the office at once, and office instruction reach the field? If any answer is no, the design is incomplete — not the implementation.
