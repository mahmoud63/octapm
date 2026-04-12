# PMcopilots Monorepo Init — Design Spec
_Date: 2026-04-12_

## Status
Approved by user.

## Goal
Finalize the monorepo scaffold so backend and frontend run together under npm workspaces, with Clerk removed and custom JWT auth as the only auth strategy.

## Current State
- `backend/` — Express.js + Prisma fully scaffolded, `node_modules` installed
- `frontend/` — shadcn-admin template (pnpm), includes `@clerk/clerk-react`
- No root `package.json` / no workspace coordination yet
- Prisma schema complete (18 models), no migration run yet
- `backend/.env` — placeholder JWT secrets (not production-ready)

## Design Decisions
| Decision | Choice | Reason |
|----------|--------|--------|
| Auth strategy | Custom JWT (bcryptjs + jsonwebtoken) | Full-stack ownership, no external SaaS dependency |
| Package manager | npm everywhere | User preference; backend already npm |
| Monorepo tooling | npm workspaces | Single lockfile, root-level dev script |

## Structure After Init

```
/
├── package.json              ← root: workspaces, concurrently dev script
├── package-lock.json         ← single lockfile
├── backend/
│   ├── package.json
│   ├── src/index.js
│   ├── prisma/schema.prisma
│   └── .env                  ← secrets must be replaced before auth work
└── frontend/
    ├── package.json          ← @clerk removed, socket.io-client added
    └── src/                  ← shadcn-admin template intact
```

## Implementation Steps

### 1. Root workspace setup
- Create `/package.json` with `workspaces: ["backend", "frontend"]`
- Add `concurrently` as root devDependency
- Root scripts: `dev` (both servers), `dev:backend`, `dev:frontend`

### 2. Frontend migration (pnpm → npm)
- Delete `frontend/pnpm-lock.yaml`
- Remove `@clerk/clerk-react` from `frontend/package.json`
- Add `socket.io-client ^4.8.0` to `frontend/package.json` dependencies
- `npm install` from root installs all workspaces

### 3. Prisma migration
- Run `npx prisma migrate dev --name init` inside `backend/`
- Generates `backend/prisma/migrations/` — confirms schema valid against live DB

### 4. Verify
- `npm run dev` from root starts both servers
- `GET http://localhost:5000/api/health` returns `{ success: true }`
- Frontend loads at `http://localhost:5173`

## Prisma Schema Summary
All 6 requested entities covered plus 12 additional Phase 1a tables:

| Entity | Notes |
|--------|-------|
| `Organisation` | Multi-tenant root, `plan`, `status` |
| `User` | 9 roles, bcrypt hash field, org-scoped |
| `Project` | Links to org, all Phase 1a relations |
| `BoqItem` | Section grouping, sort order |
| `Activity` | CPM fields (EF, LF, TF), critical path flag |
| `ActivityProgress` | Time-series progress log per activity |
| `CostRecord` | 7-category breakdown, activity-linked |
| `ChangeOrder` | Approval workflow |
| `IpcItem` | BOQ-linked certification |
| `SubValuation` | Subcontractor payment periods |
| `ProcurementOrder` | Activity-linked, lead time |
| `MaterialMaster` | Reorder points, supplier |
| `NcrRecord` | Major/minor severity, activity-linked |
| `Rfi` | Schedule impact tracking |
| `DailyReport` | Mobile input, JSON photos/materials |
| `SiteDiary` | Weather, workers, instructions |
| `ScheduleRevision` | Snapshot history |
| `ProjectAssignment` | User-project role mapping |

## Out of Scope
- Auth routes implementation
- Frontend page/component build-out
- AI service wiring
- Database seeding
- S3 / file upload wiring
