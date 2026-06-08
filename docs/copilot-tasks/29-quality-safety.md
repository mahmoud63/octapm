# Task 29 — Quality: Safety Incident Log (FR-604)

## Gap Covered
- Safety incident log with type classification (Near Miss, First Aid, LTI) and investigation status

## BRD Refs
- FR-604: Safety incident log with type classification (Near Miss, First Aid, LTI), investigation status

## DB Schema Changes

### Add `SafetyIncident` model
```prisma
model SafetyIncident {
  id                String    @id @default(uuid())
  projectId         String
  ref               String    // INC-01
  incidentType      String    // near_miss, first_aid, medical_treatment, lti, fatality
  date              DateTime
  time              String?   // "14:30"
  location          String
  description       String
  injuredPerson     String?
  company           String?   // contractor / subcontractor name
  trade             String?
  reportedBy        String
  witnessNames      String?
  rootCause         String?
  immediateActions  String?
  correctiveActions String?
  investigationStatus String  @default("open") // open, in-progress, closed
  investigatedBy    String?
  closedDate        DateTime?
  lostDays          Int       @default(0)  // for LTI
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  project Project @relation(fields: [projectId], references: [id])

  @@index([projectId])
  @@index([date])
}
```

Add `safetyIncidents SafetyIncident[]` to `Project`.

Run migration: `npx prisma migrate dev --name add_safety_incident`

## Backend Changes

### New file: `backend/src/routes/safety.js`
```
GET    /projects/:projectId/safety
POST   /projects/:projectId/safety
PATCH  /projects/:projectId/safety/:id
DELETE /projects/:projectId/safety/:id
```
Roles: PM, site_engineer.

### New file: `backend/src/services/safety.service.js`
Auto-generate ref: `INC-${count+1}`.

Return computed stats:
```js
const stats = {
  totalIncidents: all.length,
  nearMiss: all.filter(i => i.incidentType === 'near_miss').length,
  firstAid: all.filter(i => i.incidentType === 'first_aid').length,
  lti: all.filter(i => i.incidentType === 'lti').length,
  totalLostDays: all.reduce((s, i) => s + (i.lostDays || 0), 0),
  openInvestigations: all.filter(i => i.investigationStatus === 'open').length,
};
```

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/safety', require('./safety'));`

## Frontend Changes

### New file: `frontend/src/features/quality/components/safety-incident-log.tsx`

#### KPI cards
```tsx
<div className='grid grid-cols-5 gap-3 mb-4'>
  <card>Total Incidents: {total}</card>
  <card>Near Miss: {nearMiss}</card>
  <card>First Aid: {firstAid}</card>
  <card color='red'>LTI: {lti}</card>
  <card color='red'>Lost Days: {lostDays}</card>
</div>
```

#### Incident type classification badges
- `near_miss`: `bg-yellow-100 text-yellow-800` — Near Miss
- `first_aid`: `bg-blue-100 text-blue-800` — First Aid
- `medical_treatment`: `bg-orange-100 text-orange-800` — Medical Treatment
- `lti`: `bg-red-100 text-red-800` — Lost Time Injury
- `fatality`: `bg-red-900 text-white` — Fatality

#### Table columns
Ref | Date | Type | Location | Description | Injured Person | Company | Reported By | Lost Days | Investigation | Actions

#### Investigation status workflow
- Open → In Progress: assign investigatedBy
- In Progress → Closed: requires closedDate, rootCause, correctiveActions

#### Monthly trend chart
Bar chart: near miss, first aid, LTI per month.

### New file: `frontend/src/features/quality/components/safety-incident-form.tsx`
Fields: Incident Type (select), Date, Time, Location, Description (textarea), Injured Person, Company, Trade, Reported By, Witness Names, Immediate Actions taken, Lost Days (only for LTI).

## Acceptance Criteria
- [ ] Incident types: Near Miss, First Aid, Medical Treatment, LTI, Fatality
- [ ] LTI incidents show lost days count
- [ ] KPI cards show totals per type + total lost days
- [ ] Investigation workflow: open → in progress → closed
- [ ] Monthly trend chart by incident type
- [ ] Ref auto-generated INC-01, INC-02, …
