---
name: prisma-models
description: Create and modify Prisma ORM models for PMcopilots. Use when adding database tables, relations, migrations, or seed data. Enforces activity-linked data model and multi-tenant foreign keys.
---

# Prisma Schema & Database Skill

## Core Principle
**Activity-linked data model**: Every transactional entity MUST have an `activityId` field referencing the `Activity` model. This is the fundamental design principle — it enables real-time EV propagation across all modules.

## Model Template
```prisma
model NewEntity {
  id         String   @id @default(uuid())
  projectId  String
  activityId String   // MANDATORY for transactional data
  
  // entity-specific fields here
  
  status     String   @default("active")
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  project  Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  activity Activity @relation(fields: [activityId], references: [id])

  @@index([projectId])
  @@index([activityId])
}
```

## Mandatory Rules
1. **Every model needs `projectId`** — scopes data to a project (and through project, to an org)
2. **Transactional models need `activityId`** — cost records, progress, procurement, NCRs, daily reports, etc.
3. **Master data models skip `activityId`** — projects, users, organisations, BOQ items, material master
4. **Always add `@@index`** on foreign keys — `projectId`, `activityId`, `orgId`
5. **Use UUID for all IDs** — `@id @default(uuid())`
6. **Cascade delete from project** — `onDelete: Cascade` on the project relation
7. **Timestamps on everything** — `createdAt` and `updatedAt`
8. **Enum-like fields as strings** — don't use Prisma enums (harder to migrate). Use string with comments documenting valid values.

## Existing Core Models (do not recreate)
- `Organisation` — top-level tenant
- `User` — belongs to org, has role
- `Project` — belongs to org
- `ProjectAssignment` — many-to-many user↔project
- `BoqItem` — belongs to project
- `Activity` — THE CORE, belongs to project. Everything links here.
- `ActivityProgress` — belongs to activity
- `ScheduleRevision` — snapshot of generated/imported schedule
- `CostRecord` — 7-category cost breakdown per activity
- `ChangeOrder`, `IpcItem`, `SubValuation` — commercial
- `ProcurementOrder`, `MaterialMaster` — supply chain
- `NcrRecord`, `Rfi` — quality & documents
- `DailyReport` — mobile app submissions
- `SiteDiary` — daily site log

## Migration Commands
```bash
# Create migration after schema change
npx prisma migrate dev --name descriptive_name

# Reset database (DESTRUCTIVE — dev only)
npx prisma migrate reset

# Generate Prisma Client after schema change
npx prisma generate
```

## Seed Data Pattern
```js
// prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organisation.create({
    data: { name: 'Demo Construction Co.' }
  });
  
  const admin = await prisma.user.create({
    data: {
      orgId: org.id,
      name: 'Admin User',
      email: 'admin@pmcopilots.com',
      passwordHash: await bcrypt.hash('password123', 12),
      role: 'super_admin',
    }
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
```

## Query Patterns

### Always scope by org (multi-tenant)
```js
// CORRECT — scoped
const projects = await prisma.project.findMany({
  where: { orgId: user.orgId }
});

// WRONG — leaks data across tenants
const projects = await prisma.project.findMany();
```

### Include relations for dashboard
```js
const project = await prisma.project.findUnique({
  where: { id: projectId },
  include: {
    activities: { include: { progress: true, costRecords: true } },
    changeOrders: true,
    rfis: { where: { status: 'open' } },
  }
});
```
