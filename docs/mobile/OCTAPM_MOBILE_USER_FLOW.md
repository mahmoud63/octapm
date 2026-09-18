# OctaPM Mobile — User Flow

**Audience:** designers, testers and the people writing the user guides.
**Status:** the screens that exist after M1, plus the planned screens marked as such. Updated at each milestone. Companion: [Feature matrix](OCTAPM_MOBILE_FEATURE_MATRIX.md), [Implementation plan](OCTAPM_MOBILE_IMPLEMENTATION_PLAN.md).

## 1. Screen map

```
Sign in ──────────────────────────────────────────────────────────────────
  email + password · Unlock with Face ID / fingerprint (when turned on)
  Sign in with company SSO (opens the web) · Forgot password (opens the web)
        │
        ▼
Signed-in shell: five destinations, the same on every device
  phone: bottom bar          tablet: left rail + wider content
  ┌──────────┬───────────┬────────────┬──────────┬────────┐
  │  Home    │ Projects  │ Needs You  │  Search  │  More  │
  └──────────┴───────────┴────────────┴──────────┴────────┘

Home ─────────────────────────────────────────────────────
  Project strip (name · contract · switch)
  Choose a project (only when none is chosen and there are several)
  Quick actions (only those with a screen and a permission)   ← M2+
  Needs You · top three · See all
  Today · overdue / due today / ball in court
  Project health · overall + seven dimensions · pending review note
  Notifications · unread count · latest three  → Notifications

Projects ────────────────────────────────────────────────
  find · rows with status and health · current project highlighted
  tap → becomes the project; previous project's cache is dropped → Home

Needs You ───────────────────────────────────────────────
  Project strip · counts (ball in court / overdue / all)
  chips: All · Ball in court · Overdue · by record type
  rows → record (web hand-over until the record screen exists)

Search ──────────────────────────────────────────────────
  box (two characters, short pause) · scope: this project / all projects
  chips by record type · rows → record (web hand-over until built)

Notifications (from Home) ───────────────────────────────
  Unread / All · Mark all read · row → mark read + open record
  long press → archive · preferences by category (in app / push)

More ────────────────────────────────────────────────────
  Signed in as · Unlock with biometrics (on / off) · This build · Sign out

Records (from Home, Needs You, Search and Notifications) ─ M2
  RFIs ──► list (mine / overdue / status / search) ──► record
             │  question · official answer · responses · people · place ·
             │  impacts · attachments · discussion · history
             │  actions by state and permission: submit · answer · approve ·
             │  reject · close · reopen · convert to change · add response
             └─ New RFI (also the Home quick action)
  Tasks ─► list (mine / all I can see · this project / all) ──► record
             comments · history · start · blocked · mark done
  Documents ─► register by folder ──► record in the app, or the latest file
  Drawings ─► sheets (disciplines · favourites · recent · obsolete) ──► sheet
             superseded warning first · page fitted to width · pins ·
             favourite · raise RFI from here

Site and schedule (from Home) ─ M3
  Daily log ─► the day: ‹ date › · status · totals · weather · summary
               six sections with add and remove · copy yesterday · submit the day
  Activities ─► today's work / mine / critical / milestones / delayed / all ─► activity
               approved and pending progress · float · dates · method · submissions ·
               attachments · Update progress (by method) · Raise RFI · Lookahead board
  Photos ─► gallery (tags, search) ─► photo (caption, tags, camera details, records)
            Take or choose a photo → caption → onto today's daily log
  Timesheets ─► last two weeks ─► sheet (entries, submit) · New timesheet for a crew

Quality (from Home) ─ M4
  Quality home ─► score and what drives it · doors to each module the role may read
  Inspections ─► list (mine / overdue / status / type / search) ─► checklist
                 items by section · pass-fail, yes-no, options, number, text · note per item ·
                 photos per answered item · hold points · Save answers (one request) · Complete ·
                 close / reopen / void · Raise a punch item from a failed item
                 New inspection from a template (also the Home quick action)
  Punch list ─► punch / observations / both · mine · overdue · status ─► item
                 photos · discussion · history · open · ready for review · close · reopen ·
                 dispute · resolve · void, each only when the state and the server allow it
                 New punch item or observation: photo first (also the Home quick action)
  NCRs ─► list (mine / overdue / status / severity / search, filtered on the device) ─► NCR
           disposition · responsible · evidence · history · Submit closeout (comment, due,
           evidence through the workflow upload route) · approve / reject / reopen
           Raise NCR
  Safety ─► incidents (mine / overdue / status) ─► incident · same closeout and decisions
             Report an incident
  Material tests ─► pending first ─► test · Record result (pass / fail, value, date, lab)
                    Schedule a test

Inventory (from Home) ─ M5
  Inventory home ─► the warehouse this device works from (remembered) · the server's tiles ·
                    doors: Scan · Items · Goods in · Transfers · Movements
  Scan ─► camera on a phone or tablet, a typed code anywhere ─► the item and its stock by warehouse
  Items ─► find · low stock ─► item: balances · where it is · recent movements ·
           Move stock (issue, return, reserve or release, receive, adjust, damage, quarantine,
           release) — each a sheet sent once, refused offline, never queued
  Goods in ─► orders awaiting delivery ─► order: lines still due · Receive delivery
              (accepted and rejected per line, put-away bin, delivery note; one receipt number
              per delivery, so a retry counts once)
  Transfers ─► by status ─► transfer: Dispatch · Receive line by line (received, damaged)
               New transfer: from, to, items and quantities
  Movements ─► the ledger by warehouse and type, or for one item

Approvals (from Home) ─ M6
  Inbox ─► the steps waiting on this person (this project / all projects) ─► the step
           the record, every step with who answered what · the answers the template allows
           (a negative answer asks for a comment) · Open the record
           The answer goes through the respond route; the server moves the record

Commercial (from Home) ─ M6
  Commercial home ─► approvals waiting · change-event totals · doors by role
  Change events ─► list (status · kind · search) ─► event: estimate, lines, quotes, where it went
                   Raise change event (kind, origin, activity, place, ROM, days)
  Change orders ─► list ─► order: value, impact, who holds it (read; decided on the web or in Approvals)
  Commitments ─► list ─► commitment: money, schedule of values, change orders (read)
  Pay applications ─► list ─► application: period, lines, money, payments
                      Submit for review (the party that holds it); review, approve, pay stay on the web

Procurement (from Home) ─ M6
  Overview ─► counts · lead-time alerts (Acknowledge) · doors
  Packages ─► list ─► package: dates, activity, alerts, orders
  Purchase orders ─► register by status ─► order: who holds it, money, lines, deliveries ·
                     Receive delivery (hands over to Inventory)
  Long lead ─► the register
```

Planned destinations as their milestones land: outbox and offline status (M7).

## 2. Navigation rules

- The five destinations never change with role. What changes is the content: a role sees only the modules and actions the server allows on the current project.
- Every project-scoped screen carries the project strip at the top. There is no way to view two projects at once; switching drops the previous project's cached records before the next is shown.
- Records that do not have a screen in the app yet open on the web platform at the exact record, in the system browser, where the web signs the person in itself. The app says so on the screen that hands over.
- Back always returns to the destination the person came from. Deep links (M9) open the record's screen with the destination underneath, so back lands somewhere sensible.

## 3. Role entry points

| Role | Lands on | First things on Home |
|---|---|---|
| Project Manager | Home | approvals and decisions in Needs You, project health, notifications |
| Planning Engineer | Home | progress and lookahead items, RFI and submittal reviews |
| QS | Home | RFI and submittal reviews, change events |
| Cost Controller | Home | health tiles, timesheet items to review (web) |
| Procurement | Home | purchase orders and deliveries in Needs You, lead-time alerts |
| Warehouse | Home | goods in and transfers in Needs You; Inventory home when M5 lands |
| Site Engineer | Home | daily log, punch, RFIs, inspections assigned to them |
| Quality Engineer | Home | inspections, NCRs, punch closeouts, safety |
| Finance | Home | view-only tiles; IPC and payments stay on the web |
| Parties (owner, consultant, contractor, subcontractor) | Home | exactly what the party policy grants; NCR and safety never appear |

## 4. Field workflows (as built and as planned)

1. **Answer what is waiting.** Home → Needs You row → record → act (respond, decide, close) → back to Needs You with the item gone. Until M2, the record opens on the web.
2. **Switch site.** Any screen → project strip → Projects → tap → Home for that project.
3. **Find a record.** Search → type a reference or a word → tap → record.
4. **Catch up.** Home → Notifications → tap → record (marked read); long press to archive.
5. **Raise something from the field (M2–M5).** Home → quick action → short form pre-filled with project, person and date → save (queued when offline) → record.
6. **Walk the drawings (M2).** Documents → drawing → sheet → zoom, pan → pin → punch or RFI from the pin. A superseded sheet is flagged before anything else.
7. **Close the day (M3).** Home → Daily log → today → sections → submit.
8. **Inspect and close out (M4).** Home → Quality → Inspections → New inspection → template → checklist → answers saved in one request → a failed item raises a punch item → Complete; the punch item goes ready for review and is closed by the approver. An NCR or a safety incident is closed out with a comment and evidence photos, then approved or rejected by quality.
9. **Receive a delivery (M5).** Home → Inventory → Goods in → the order → Receive delivery → correct the pre-filled quantities from the delivery note, choose the bin → Post. The receipt number was made on the device, so posting again after a lost reply counts once.
10. **Issue stock to the work (M5).** Home → Inventory → Scan → the item → Issue to site → warehouse, quantity, activity → Send. Offline, the sheet refuses; the movement is never queued.
11. **Answer an approval (M6).** Home → Approvals → the step → Approve, or Reject with a comment → the server moves the change order, commitment or pay application; the app never calls an approve route itself.
12. **Raise a change from the field (M6).** Home → Commercial → Change events → Raise change event → what changed, kind, origin, ROM, days → the event; pricing, quotes and conversion follow on the web.

## 5. Tablet flows (M8, as built)

Same destinations, laid out as a rail. On the expanded width class every route group with records is master–detail: the section's list stays on the left with its filters and scroll, the record opens on the right, back returns the pane to "Choose a record on the left", and rotation keeps the person on the same record. Nested groups follow the section: Quality shows the punch list beside a punch item, Inventory the items beside an item, Commercial the change events beside one.

Wide-screen work that the phone does not offer: the activities timeline (a bar per activity, the critical ones marked, a line for today), progress approval on an activity's submissions with a hold-point warning, and the signature pad on a checklist's signature item, drawn with a finger, a stylus or the mouse and sent as a PNG.

## 6. Offline and sync flows (M7, as built)

The rules are in the [offline policy](OCTAPM_MOBILE_OFFLINE_POLICY.md); on screen they look like this.

1. **The signal goes.** A bar across the top of the shell says "Offline · showing what was saved on this device"; every list's freshness line says Offline with the age of what it shows. Screens the person has opened before draw from the cache kept on the device.
2. **Capturing offline.** Raising a punch item, starting an inspection, adding a daily-log entry, starting a timesheet, posting a goods receipt or taking photos onto the daily log saves the item to the outbox with its replay key. The form says so and goes to the outbox (or, on the daily log, shows the notice in place). Anything without a replay key, and every stock movement or approval, refuses politely and waits for a signal.
3. **The signal returns.** The bar says "Sending n items…", the outbox drains oldest first, a photo only after the record it belongs to, and each item turns Sent. The same happens when the app comes back to the front.
4. **The server refuses one.** The bar turns red: "1 item needs your attention". The outbox shows the server's reason under the item with Try again and Discard. Nothing is dropped quietly.
5. **The session is refused.** The queue is kept and locked; signing in again as the same person sends it. A different person signing in discards it.
6. **A kept sheet goes stale.** The register marks it "Newer revision" and the viewer shows the superseded warning with "Keep the latest revision".

## 7. Notification, deep-link and live-update flows (M9, as built)

1. **A notification tap.** Push notification → tap → the record’s screen, with its list underneath so back lands somewhere sensible; a tap that launched the app is handled on start. A notification for a project other than the current one goes through the opener, which switches the project first.
2. **A link from an email or the web.** `app.octapm.com/projects/…`, the web platform’s own record path or an `octapm://` link → the same resolver → the record. A link the app has no screen for lands on Home.
3. **Someone else changes the record.** The socket carries the server’s event for the project; the open list or record refetches on its own and the freshness line updates. Nothing is applied from the event itself; what is shown always comes from the API.
4. **Mark up a photo.** Take or choose a photo → Mark up photo → draw over it (four pen colours, undo, clear) → Use marked photo → caption → upload. The marked copy is what goes to the daily log or the punch item.
