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
```

Site and schedule (from Home) ─ M3
  Daily log ─► the day: ‹ date › · status · totals · weather · summary
               six sections with add and remove · copy yesterday · submit the day
  Activities ─► today's work / mine / critical / milestones / delayed / all ─► activity
               approved and pending progress · float · dates · method · submissions ·
               attachments · Update progress (by method) · Raise RFI · Lookahead board
  Photos ─► gallery (tags, search) ─► photo (caption, tags, camera details, records)
            Take or choose a photo → caption → onto today's daily log
  Timesheets ─► last two weeks ─► sheet (entries, submit) · New timesheet for a crew
```

Planned destinations reached from Home, Needs You and Search as their milestones land: quality home, inspections, punch, NCR, safety (M4), inventory home, scan, goods receipt, issue, transfer (M5), change events, workflow inbox, procurement views (M6), outbox and offline status (M7).

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
8. **Receive a delivery (M5).** Inventory → scan → purchase order → quantities → post.

## 5. Tablet flows

Same destinations, laid out as a rail. Lists become master–detail on the expanded width class (M8): the list stays on the left, the record opens on the right, and the project strip spans the top. Rotation keeps the person on the same record.

## 6. Offline and sync flows

Described in the [offline policy](OCTAPM_MOBILE_OFFLINE_POLICY.md). On screen: a freshness line on every list (Live / Updated n minutes ago / Offline), an outbox badge on Home and in More (M7), and a needs-attention list for queued items the server refused.

## 7. Notification and deep-link flows (M9)

Push notification → tap → app opens on the record's screen, with the destination underneath. A universal link from an email or the web (`app.octapm.com/projects/…`) does the same. Until M9, notification rows open the record on the web.
