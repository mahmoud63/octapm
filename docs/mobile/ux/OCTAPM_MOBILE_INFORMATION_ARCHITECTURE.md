# OctaPM Mobile — Information Architecture

**Audience:** whoever implements UX2-A, and anyone arguing about where a screen belongs.
**Date:** 2026-09-19. **Status:** design. Every destination named here was verified to exist against the running API or the route tree; where something does not exist it is marked and not promised.

## 1. What is wrong with the architecture today

Measured, not asserted:

- **Seventy screens, one navigation.** `app/(app)/_layout.tsx` declares five tabs — Home, Projects, Needs You, Search, More — identical for all nine roles, and then hides **sixteen module stacks** behind `href: null`.
- **The hidden modules are reached from a wall of buttons.** Home renders a row of up to six quick actions and then a row of **thirteen identical secondary buttons** — Daily log, Activities, Photos, Quality, Inventory, Approvals, Commercial, Procurement, RFIs, Tasks, Documents, Drawings, Timesheets. That is a menu, not a home screen, and it is the clearest symptom of "a small version of the website".
- **Role shows up only as subtraction.** The same thirteen buttons are permission-filtered. A storekeeper and a project manager get the same shape of screen with different things missing.
- **A whole platform is invisible.** The backend serves locations (a real tree), project team, equipment, risks, meetings, submittals, specifications, transmittals, daily reports, site diaries, lookaheads, weather delays, the audit feed, cash flow, IPC and EOT. **None of them has a mobile screen.**

## 2. The organising idea

Three layers, and every screen belongs to exactly one:

| Layer | Question it answers | Examples |
|---|---|---|
| **Me** | What do I have to do? | Home/Today, Needs You, Notifications, Outbox/Sync, Capture |
| **Project** | What is happening here? | Project Dashboard, Overview, Activity feed, Locations, Team, Photos |
| **Record** | What is this thing, and what do I do about it? | every list → detail → related/evidence/history |

The current app collapses Me and Project into one Home and makes Record a flat list of modules. Separating them is what makes room for role-shaped navigation: **the Me layer differs by role; the Project and Record layers do not.**

## 3. Global navigation

Five slots, always. What sits in them depends on the signed-in role. The mechanism already exists: expo-router's `<Tabs.Screen href={null}>` hides a destination, so the tab set is computed from the role and the permission matrix, and every other stack stays routable by deep link.

**The rule for the fifth slot:** field roles get a centre **Capture** action; management roles get a second analytical destination instead. A PM does not need a camera under their thumb; a site engineer needs nothing else there.

| Role (`RoleId`) | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| `pm` Project Manager | Home | Needs You | Project | Controls | More |
| `site_engineer` Site Engineer | Today | Site | **Capture** | Drawings | More |
| `quality_engineer` Quality Engineer | Today | Inspections | **Capture** | Issues | More |
| `warehouse` Storekeeper | Home | Scan | Receive | Issue | More |
| `procurement` Procurement | Home | Orders | Deliveries | Suppliers | More |
| `planning_eng` Planning Engineer | Home | Schedule | Lookahead | Progress | More |
| `qs` QS / Commercial | Home | Needs You | Commercial | Changes | More |
| `cost_controller` Cost Controller | Home | Needs You | Cost | Commercial | More |
| `finance` Finance | Home | Needs You | Commercial | Reports | More |

Every one of those destinations resolves to an endpoint that exists: `Suppliers` to `/projects/:id/procurement` (which returns `{suppliers, packages, orders, alerts, summary}`), `Cost` to `/projects/:id/cost` and `/cost/summary`, `Reports` to `/reports` (org-level; there is **no** per-project `/reports`), `Lookahead` to `/projects/:id/lookaheads`, `Scan` to the existing scan screen.

**Projects and Search lose their tab slots.** Both are wrong as permanent destinations: project switching belongs in the header (it is already a component, `ProjectSwitch`, shown on most screens), and search belongs in the header of every list plus a global entry in More and the command surface. Neither is a place a person goes five times a day; Needs You and Capture are.

### Admin

There is no `admin` role. `User.isCompanyAdmin` is a **boolean overlay** granting org-wide project visibility and user/permission administration. So there is no tenth navigation: an admin is a PM (or whatever role they hold) whose **More** gains an Administration group — users, permissions, companies, project parties. This is the honest answer to §5's tenth experience.

### Multi-role users (§39)

**The question does not arise in this data model.** `User.role` is a single value, org-wide, and there is no per-project role model — no `ProjectMember.role`, no project-scoped override. A person is one role everywhere. So there is no combined navigation to design and no workspace switcher to build; if a per-project role is ever introduced, the primary-role rule above is the place to extend.

## 4. The Me layer

### Home / Today

Two shapes, chosen by role, and they differ in kind rather than in content:

- **Management Home** (pm, qs, cost_controller, finance, planning_eng) is an **exception report**: what needs my decision, what is late, what is at risk, what changed, what the numbers say. Detail in the [role experience](OCTAPM_MOBILE_ROLE_EXPERIENCE.md) and [spec](OCTAPM_MOBILE_UX_V2_SPEC.md).
- **Field Today** (site_engineer, quality_engineer, warehouse, procurement) is a **work list**: what am I building today, where, which drawing, what is blocked, what must I capture.

Both are one project at a time, named in the header, with the project switch there.

### Needs You

Grouped, not filtered. The current screen is one flat list with chips; §36 wants sections, and the assignments API already returns per-item `overdue`, `ballInCourt`, `dueDate`, `recordType` and `label`, which is enough to group without asking the server for anything new:

**Overdue · Due today · Approvals · Quality · Commercial · Site · Tasks · Everything else.**

Each row carries record, reference, project, action required, age, due date and who holds the ball. Chips stay for type filtering within the grouping.

### Capture, Notifications, Sync Center

Capture is §17's sheet. Notifications gains the tabs §35 asks for (All, Needs You, Mentions, Approvals, RFI, Quality, Procurement, Tasks, System): the `Notification` model carries `type`, `category`, `event` and `priority`, so the tabs group on data that already exists, and §35's "what happened, where, who, when, what I must do" maps onto `event`, `projectId`, `actorId`, `createdAt` and `actionUrl` — with `entityType`/`entityId` giving the exact record to open. The outbox becomes **Sync Center**: saved, pending, syncing, failed, conflict, in words.

## 5. The Project layer

New, and mostly absent today.

| Screen | Source | Status |
|---|---|---|
| **Project Dashboard** | `/projects/:id/health`, `/forecast`, `/cost/summary`, `/daily-logs/:today` | all exist; no `/dashboard` endpoint — the screen composes them |
| **Project Overview** | `/projects/:id` plus `/team` | exists; no `/overview` endpoint |
| **Project Activity feed** | `/projects/:id/audit` → `{events, nextCursor}` | exists, cursor-paged |
| **Locations** | `/projects/:id/locations` → `{items, tree, summary}` | exists — a materialized-path tree with `kind` in site/building/level/zone/room/area/external |
| **Location detail** | the `Location` back-relations | photos, sheets, punch items, form instances, RFIs, time entries, change events, lookahead items and delivery orders **all carry `locationId` today**. Activities, NCRs, tasks and inventory **do not** — those tabs are derived or omitted, never faked |
| **Project Photos** | `/projects/:id/photos` | exists, filters by date range, tags and **location subtree** |
| **Team** | `/projects/:id/team` → `{items, parties}` | exists |

**Controls** (the PM's fourth slot) is the §8 control centre: one screen with Schedule, Commercial, Cost, Procurement, Quality, Site, Documents and Risks as sections, each opening its module already scoped to this project.

## 6. The Record layer

Every record type follows one shape, so the app is learnable once:

```
LIST  → filters, freshness, search, grouping
        ↓
DETAIL  header (reference · title · status · location · ball in court)
        Overview | Evidence | Activity | Related          ← tabs
        sticky contextual actions
```

The tab set is uniform: **Overview** (the facts), **Evidence** (attachments and photos, with Capture), **Activity** (comments and status history), **Related** (the linked records). A record type that genuinely has nothing for a tab does not show it.

This is the §27 answer to "list → tiny popup": today twenty-one of seventy screens are detail pages and several are thin. The [page inventory](OCTAPM_MOBILE_PAGE_INVENTORY.md) says which get expanded and which get created.

## 7. Tablet

The width classes already exist (`compact <600`, `medium 600–899`, `expanded ≥900`) and **master–detail is already implemented** through `SplitGroup` in eleven module layouts — activities, commercial, drawings, inventory, photos, procurement, quality, rfi, tasks, timesheets, workflow. That part of the platform is sound and must be preserved.

What is missing on tablet is the **third pane** and the density to fill it. The expanded layout becomes:

```
[ rail ] [ list ] [ record ] [ evidence · history · actions ]
```

and, on the dashboards, a two-column composition rather than one column of stretched cards. iPad multitasking already works in principle (`requireFullScreen: false`, width-driven layout) but is unverified on hardware — see the [iPad report](../OCTAPM_IPAD_NATIVE_REPORT.md).

## 8. What this architecture does not promise

- No per-project `/reports`, `/budget`, `/dashboard`, `/overview`, `/site-reporting`, `/earned-value` or `/schedule/metrics` endpoint exists. Screens that want those compose existing endpoints or do without.
- **SPI can be null.** The forecast endpoint returned `spi: null` with `cpi: 0.742` on the certified project. Any schedule KPI must render an honest em-dash rather than a fabricated number.
- Locations exist as a model but the end-to-end project has **zero** location rows. The Locations experience must have a real empty state that explains how locations get created, not a blank screen.
- Inventory items, stock movements and equipment **cannot carry attachments** today. See the [photo system](OCTAPM_MOBILE_PHOTO_SYSTEM.md) §2.
