# Task 24 — Commercial: EOT Claim Builder & LD Calculation (BR-007, BRU-05, AC-07)

## Gaps Covered
- EOT claim builder (5-step wizard): event selection, affected activities, float analysis, LD calculation, claim document generation
- Liquidated damages calculation (BRU-05: LD = LD Rate × Days of Delay)

## BRD Refs
- BR-007: EOT claim builder — event selection, affected activities, float analysis, LD calculation, printable claim document
- BRU-05: Liquidated Damages = LD Rate ($/day) × Days of Delay
- AC-07: EOT claim document includes affected activities, float before/after analysis, LD calculation, printable claim letter

## DB Schema Changes

### Add `EotClaim` model
```prisma
model EotClaim {
  id              String   @id @default(uuid())
  projectId       String
  ref             String   // EOT-01
  eventDescription String
  eventDate       DateTime?
  delayDays       Int      @default(0)
  ldRatePerDay    Float    @default(0)
  ldExposureBefore Float   @default(0)
  ldExposureAfter  Float   @default(0)
  ldSaving        Float    @default(0)
  status          String   @default("draft")  // draft, submitted, approved, rejected
  affectedActivities Json? // array of activity IDs + names + float analysis
  floatAnalysis   Json?   // before/after float for each affected activity
  claimLetterText String? // generated text for claim letter
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id])

  @@index([projectId])
}
```

Add `eotClaims EotClaim[]` to `Project`.

Run migration: `npx prisma migrate dev --name add_eot_claim`

### Update `Project` model to include LD rate
```prisma
  ldRatePerDay    Float?   // Liquidated Damages rate ($/day)
  completionDate  DateTime? // contractual completion date
```
Run migration: `npx prisma migrate dev --name add_project_ld_rate`

## Backend Changes

### New file: `backend/src/routes/eot.js`
```
GET    /projects/:projectId/eot
POST   /projects/:projectId/eot               — create draft claim
PATCH  /projects/:projectId/eot/:id           — update claim (any step)
POST   /projects/:projectId/eot/:id/submit    — submit claim
DELETE /projects/:projectId/eot/:id
```

### New file: `backend/src/services/eot.service.js`

#### `createEotClaim({ orgId, projectId, payload })`
Auto-generate ref `EOT-${count+1}`.

#### `computeLd({ project, delayDays })`
```js
// BRU-05
const ldRate = project.ldRatePerDay || 0;
const ldExposure = ldRate * delayDays;
return ldExposure;
```

#### `generateClaimText({ claim, project, activities })`
Build a structured text claim letter:
```js
return `
EXTENSION OF TIME CLAIM
Ref: ${claim.ref}
Project: ${project.name}
Event: ${claim.eventDescription}
Event Date: ${formatDate(claim.eventDate)}

DELAY ANALYSIS:
Delay claimed: ${claim.delayDays} calendar days
Affected activities: ${claim.affectedActivities?.length || 0}

FLOAT ANALYSIS:
[Table of affected activities with float before/after]

LIQUIDATED DAMAGES:
LD Rate: $${project.ldRatePerDay}/day
LD Exposure (without EOT): $${claim.ldExposureBefore.toLocaleString()}
LD Saving (with EOT grant): $${claim.ldSaving.toLocaleString()}

This claim is submitted in accordance with [Contract Clause].
`.trim();
```

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/eot', require('./eot'));`

## Frontend Changes

### New file: `frontend/src/features/commercial/components/eot-wizard.tsx`
5-step wizard using a stepped tab layout:

```tsx
const STEPS = [
  { id: 1, title: 'Delay Event' },
  { id: 2, title: 'Affected Activities' },
  { id: 3, title: 'Float Analysis' },
  { id: 4, title: 'LD Calculation' },
  { id: 5, title: 'Claim Document' },
]
```

#### Step 1 — Delay Event
Fields: Event description (textarea), Event date (date picker), Delay days (number), Cause category (select: Employer Risk, Force Majeure, Neutral, Contractor Risk).

#### Step 2 — Affected Activities
Multi-select from project activities. Show activity name, current float, status. User selects which activities are affected.

#### Step 3 — Float Analysis
For each selected activity, show:
- Float before delay event: `totalFloat` from DB
- Float after (estimated): `totalFloat - delayDays` (can go negative)
- Critical path impact: yes if float after ≤ 0

Table: Activity | Float Before | Float After | CP Impact

#### Step 4 — LD Calculation (BRU-05)
```tsx
// Display read from project settings
<div className='grid grid-cols-2 gap-4'>
  <div>
    <p>LD Rate</p>
    <p className='text-2xl font-bold'>${project.ldRatePerDay}/day</p>
  </div>
  <div>
    <p>Delay Claimed</p>
    <p className='text-2xl font-bold'>{delayDays} days</p>
  </div>
  <div>
    <p>LD Exposure (without EOT)</p>
    <p className='text-2xl font-bold text-red-600'>${(ldRatePerDay * delayDays).toLocaleString()}</p>
  </div>
  <div>
    <p>LD Saving (if EOT granted)</p>
    <p className='text-2xl font-bold text-green-600'>${(ldRatePerDay * delayDays).toLocaleString()}</p>
  </div>
</div>
```

#### Step 5 — Claim Document
Show generated claim letter text in a monospaced textarea (read-only).
Print button: `window.print()` with print-only CSS showing only the claim letter.

```tsx
<Button onClick={() => window.print()}>
  Print Claim Letter
</Button>
```

Add print CSS:
```css
@media print {
  .no-print { display: none !important; }
  .claim-letter { display: block !important; font-family: serif; font-size: 12pt; }
}
```

### New file: `frontend/src/features/commercial/components/ld-calculator.tsx`
Standalone LD calculator card (outside wizard) for quick calculations:
- Input: LD Rate ($/day), Days of Delay, EOT days granted
- Output: LD Exposure, LD after EOT, Saving

## Acceptance Criteria (AC-07)
- [ ] Wizard has 5 steps: event, activities, float, LD, document
- [ ] Step 2: multi-select from project activities
- [ ] Step 3: float before/after table with CP impact flag
- [ ] Step 4: LD = ldRatePerDay × delayDays (BRU-05)
- [ ] Step 5: printable claim letter with all required sections
- [ ] `window.print()` produces clean print-ready output
- [ ] Claim saved to DB with all fields including floatAnalysis JSON
