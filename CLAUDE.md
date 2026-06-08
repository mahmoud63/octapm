# PMcopilots — AI Construction Project Management Platform

## Overview
PMcopilots replaces Primavera P6 + Excel with a single AI-powered SaaS platform for construction project management. Every record (cost, material, procurement, quality) links to a schedule Activity ID. Progress updates propagate instantly to EV metrics and dashboards.

## Architecture
```
pmcopilots/
├── backend/          # Express.js REST API
│   ├── src/
│   │   ├── config/       # DB, auth, AI provider config
│   │   ├── middleware/    # auth, rbac, error handling, tenant isolation
│   │   ├── models/       # Prisma schema (or Sequelize models)
│   │   ├── routes/       # Express route definitions
│   │   ├── services/     # Business logic (EV calc, CPM engine, AI orchestration)
│   │   ├── parsers/      # P6 XER, P6 XML, MSP XML, BOQ Excel parsers
│   │   └── utils/        # JSON repair, helpers
│   ├── prisma/
│   │   └── schema.prisma
│   └── package.json
├── frontend/         # React SPA (Vite + shadcn/ui + Tailwind CSS)
│   ├── src/
│   │   ├── components/   # Reusable UI (sidebar, cards, charts, tables)
│   │   ├── pages/        # Module pages (dashboard, schedule, cost, etc.)
│   │   ├── hooks/        # Custom hooks (useAuth, useProject, useEV)
│   │   ├── services/     # API client (axios/fetch wrappers)
│   │   ├── stores/       # Zustand state management
│   │   └── lib/          # Utilities, constants, types
│   └── package.json
├── docs/             # PRD, BRD, specs
└── CLAUDE.md         # This file
```

## Tech Stack
- **Backend:** Node.js 20+, Express.js, Prisma ORM, PostgreSQL
- **Frontend:** React 19, Vite, shadcn/ui, Tailwind CSS v4, Recharts, TanStack Table
- **Auth:** JWT access + refresh tokens, bcrypt password hashing
- **Real-time:** WebSocket (socket.io) for dashboard live updates
- **AI:** Provider-agnostic layer — Claude API as primary, GPT/Gemini as fallback
- **File Storage:** S3-compatible (for photos, BOQ uploads, exports)
- **API Docs:** OpenAPI/Swagger (serves mobile team)

## Frontend Template
Based on **shadcn/ui admin dashboard** pattern:
- Collapsible sidebar with 8 module groups and 50+ pages
- Light/dark mode (default dark to match construction PM aesthetic)
- RTL support ready (for Arabic localization later)
- Cmd+K command palette for quick navigation
- TanStack Table for all data tables
- Recharts for all charts (S-curves, bar charts, gauges)

## Key Business Rules (enforce in backend)
- TF = Late Finish - Early Finish; TF = 0 → critical path
- SPI = EV / PV; below 0.9 triggers alert
- CPI = EV / AC; below 0.9 triggers alert  
- EAC = Total Budget / CPI
- BOQ > 60 items → auto-chunk by section (max 60 per batch)
- P6 XER durations in hours / 8 = working days
- Retention default 5% of certified value per IPC period
- Weather delay warning at 70%+ of contractual allowance consumed
- Quality Score = 100 - (majorNCRs × 20) - (minorNCRs × 8) - (failedITPs × 15)
- Activity auto-status: 0%=To Do, 1-99%=In Progress, 100%=Complete, past end date <100%=Delayed

## User Roles (8 roles — enforce via RBAC middleware)
PM (all access), Planning Engineer, QS, Cost Controller, Procurement, Warehouse, Site Engineer, Finance

## Database Design Principle
**Activity-linked data model:** Every transactional table has an `activity_id` foreign key referencing the `activities` table. This is NON-NEGOTIABLE — it's what makes real-time EV propagation work.

## API Design
- Base: `/api/v1/`
- Auth: JWT in Authorization header
- Response envelope: `{ success: true, data: {...} }` or `{ success: false, error: { code, message } }`
- Pagination: cursor-based for large lists
- Multi-tenant: org_id scoped via middleware on every query
- Mobile team consumes the same API — document every endpoint in Swagger

## Scope Boundaries
- ✅ YOU build: Express.js API, React frontend, AI service, file parsers, DB schema
- ❌ You do NOT build: Mobile app UI (separate team — you provide API + Swagger docs only)
- ❌ Phase 1 does NOT include: BIM/4D, ERP integration, multi-project portfolio, two-way P6 sync

## Phase 1a MVP Modules (Must Have — build these first)
1. Auth (login, register, JWT, RBAC)
2. Project CRUD
3. BOQ upload & management
4. AI Schedule Generation (3-pass engine)
5. P6/MSP Import (XER, P6 XML, MSP XML)
6. Activities & CPM engine
7. Progress Tracking + Real-time EV
8. PM Dashboard (7-dimension health)
9. Cost Control (7-category breakdown)
10. Commercial (change orders, IPC, sub valuations, cash flow, EOT wizard)
11. Procurement + Long-lead items
12. Risk Register + Schedule History
13. Export (XLSX multi-sheet, PDF)

## Coding Standards
- Before creating a commit, pull the latest `origin/main` into the current branch and resolve conflicts. After committing, push the branch again.
- TypeScript on frontend, JavaScript (or TypeScript) on backend
- Async/await everywhere, no callbacks
- All API errors must be caught and returned with structured error codes
- Database queries always scoped by org_id (multi-tenant)
- No business logic in route handlers — delegate to service layer
- Every endpoint needs input validation (express-validator or zod)
- Passwords: bcrypt with 12 salt rounds
- Never store secrets in client code or git

## Build & Run
```bash
# Backend
cd backend && npm install && npx prisma migrate dev && npm run dev

# Frontend
cd frontend && npm install && npm run dev
```

## Key Reference Docs
- `docs/PMcopilots_PRD_v2.docx` — Full PRD with all features, API design, DB schema, and phasing
- `docs/PMcopilots_BRD_v3.docx` — Original BRD with detailed functional requirements
- `docs/PMcopilots_v13.jsx` — Working prototype (8,400 lines) with all module data structures and UI patterns
