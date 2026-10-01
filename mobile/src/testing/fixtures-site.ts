/** Site-reporting and schedule fixtures for the M3 tests, shaped like the live API of 2026-09-18. */
import type { Activity, DailyLog, DailyLogEntry, Lookahead, LookaheadItem, Photo, ProgressMethod, Timesheet } from '@/api/site-types'
import { matrix } from '@/testing/fixtures'

export const today = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

export const emptyLog = (date = today, over: Partial<DailyLog> = {}): DailyLog => ({
  id: null,
  exists: false,
  projectId: 'p1',
  date,
  status: 'open',
  weather: null,
  weatherSource: null,
  summary: null,
  submittedAt: null,
  submittedBy: null,
  approvedAt: null,
  approvedBy: null,
  sections: { manpower: [], equipment: [], deliveries: [], visitors: [], delays: [], notes: [] },
  totals: { workers: 0, manHours: 0, companies: 0, equipmentCount: 0, equipmentHours: 0, idleHours: 0, deliveries: 0, visitors: 0, hoursLost: 0, notes: 0, entries: 0, awaitingReview: 0 },
  path: `/projects/p1/site-reporting?date=${date}`,
  ...over,
})

export const manpowerEntry = (over: Partial<DailyLogEntry> = {}): DailyLogEntry => ({
  id: 'e1',
  section: 'manpower',
  partyId: null,
  party: null,
  status: 'approved',
  createdBy: 'u1',
  clientRequestId: 'c1',
  companyName: 'Delta Steelfixing',
  trade: 'Steelfixers',
  workers: 6,
  hours: 9,
  manHours: 54,
  activityId: 'a1',
  activity: { id: 'a1', name: 'Foundation concrete' },
  locationId: null,
  location: null,
  notes: null,
  createdAt: `${today}T07:00:00.000Z`,
  ...over,
})

export const logWithEntries = (): DailyLog =>
  emptyLog(today, {
    id: 'log1',
    exists: true,
    weather: { condition: 'sunny', tempMinC: 24, tempMaxC: 38, precipitationMm: 0, windMaxKph: 12 },
    summary: 'Raft pour at grid A-D completed by 15:00.',
    sections: { manpower: [manpowerEntry()], equipment: [{ id: 'e2', section: 'equipment', partyId: null, party: null, status: 'approved', createdBy: 'u1', clientRequestId: 'c2', name: '50 t crawler crane', count: 1, hoursOperated: 8, hoursIdle: 1 }], deliveries: [], visitors: [], delays: [{ id: 'e3', section: 'delays', partyId: null, party: null, status: 'approved', createdBy: 'u1', clientRequestId: 'c3', type: 'weather', hoursLost: 2, notes: 'Sandstorm 11:00–13:00' }], notes: [] },
    totals: { workers: 6, manHours: 54, companies: 1, equipmentCount: 1, equipmentHours: 8, idleHours: 1, deliveries: 0, visitors: 0, hoursLost: 2, notes: 0, entries: 3, awaitingReview: 0 },
  })

export const activity = (over: Partial<Activity> = {}): Activity => ({
  id: 'a1',
  projectId: 'p1',
  name: 'Foundation concrete',
  activityCode: 'A130',
  wbsCode: '1 Substructure',
  category: 'structural',
  startDate: '2026-09-01T00:00:00.000Z',
  endDate: '2026-10-15T00:00:00.000Z',
  earlyStartDate: '2026-09-01T00:00:00.000Z',
  earlyFinishDate: '2026-10-15T00:00:00.000Z',
  lateFinishDate: '2026-10-15T00:00:00.000Z',
  totalFloat: 0,
  duration: 32,
  budget: 1850000,
  isMilestone: false,
  isCritical: true,
  sortOrder: 1,
  pctComplete: 40,
  actualStart: '2026-09-01T00:00:00.000Z',
  actualFinish: null,
  approvedProgressUpdatedAt: '2026-09-15T00:00:00.000Z',
  progressMethod: 'percent',
  pendingProgress: null,
  progressApprovalStatus: 'approved',
  status: 'in_progress',
  assignedEngineers: [{ id: 'u1', name: 'Dana Okafor' }],
  ...over,
})

export const activities: Activity[] = [
  activity(),
  activity({ id: 'a2', name: 'Superstructure level 1', activityCode: 'A200', wbsCode: '2 Superstructure', startDate: '2030-01-01T00:00:00.000Z', endDate: '2030-03-01T00:00:00.000Z', earlyStartDate: '2030-01-01T00:00:00.000Z', earlyFinishDate: '2030-03-01T00:00:00.000Z', lateFinishDate: '2030-03-10T00:00:00.000Z', totalFloat: 7, isCritical: false, pctComplete: 0, status: 'todo', assignedEngineers: [], progressMethod: 'quantity' }),
  activity({ id: 'a3', name: 'Practical completion', activityCode: 'M900', isMilestone: true, startDate: '2030-06-01T00:00:00.000Z', endDate: '2030-06-01T00:00:00.000Z', pctComplete: 0, status: 'todo', assignedEngineers: [] }),
  activity({ id: 'a4', name: 'Site clearance', activityCode: 'A100', startDate: '2026-01-05T00:00:00.000Z', endDate: '2026-02-01T00:00:00.000Z', pctComplete: 80, status: 'delayed', isCritical: false, assignedEngineers: [] }),
]

export const percentMethod: ProgressMethod = { activityId: 'a1', method: 'percent', plannedQuantity: null, quantityUnit: null, milestoneWeights: [], inspectionRequired: false, evidenceRequired: false, notes: null }
export const quantityMethod: ProgressMethod = { activityId: 'a2', method: 'quantity', plannedQuantity: 4200, quantityUnit: 'm3', milestoneWeights: [], inspectionRequired: false, evidenceRequired: true, notes: null }

export const lookahead = (): Lookahead & { items: LookaheadItem[] } => ({
  id: 'la1',
  title: 'Weeks 38–40',
  status: 'published',
  startDate: '2026-09-14',
  weeks: 3,
  items: [
    { id: 'li1', name: 'Raft pour grid A-D', activityId: 'a1', wbsCode: '1 Substructure', plannedStart: '2026-09-15', plannedFinish: '2026-09-18', companyId: null, assigneeUserId: null, locationId: null, quantity: 420, unit: 'm3', status: 'in_progress', pctComplete: 60, varianceReason: null, constraint: null, constraintStatus: 'none', notes: null },
    { id: 'li2', name: 'Backfill east side', activityId: 'a1', wbsCode: '1 Substructure', plannedStart: '2026-09-17', plannedFinish: '2026-09-19', companyId: null, assigneeUserId: null, locationId: null, quantity: null, unit: null, status: 'planned', pctComplete: 0, varianceReason: null, constraint: 'Permit for night work', constraintStatus: 'open', notes: null },
  ],
})

export const photo = (over: Partial<Photo> = {}): Photo => ({
  id: 'ph1',
  documentId: 'doc9',
  locationId: 'l1',
  location: { id: 'l1', name: 'Foundation zone, grid A-D' },
  caption: 'Raft pour, grid A-D',
  tags: ['concrete', 'grid A-D'],
  takenAt: '2026-09-18T06:40:00.000Z',
  latitude: 24.71,
  longitude: 46.67,
  cameraMake: 'Apple',
  cameraModel: 'iPhone 15',
  width: 4032,
  height: 3024,
  thumbnailStatus: 'ready',
  uploadedBy: { id: 'u1', name: 'Dana Okafor' },
  records: [{ recordType: 'daily_log', recordId: '2026-09-18', title: 'Daily log' }],
  createdAt: '2026-09-18T06:41:00.000Z',
  ...over,
})

export const timesheet = (over: Partial<Timesheet> = {}): Timesheet => ({
  id: 'ts1',
  date: today,
  status: 'draft',
  crewId: 'crew1',
  crew: { id: 'crew1', name: 'Steelfixing crew A' },
  companyId: null,
  notes: null,
  entries: [
    { id: 'te1', workerId: 'w1', worker: { id: 'w1', name: 'Ahmed Ali' }, activityId: 'a1', timeType: 'regular', hours: 9 },
    { id: 'te2', workerId: 'w2', worker: { id: 'w2', name: 'Joseph Okoro' }, activityId: 'a1', timeType: 'regular', hours: 9 },
  ],
  totals: { regularHours: 18, overtimeHours: 0, workers: 2 },
  ...over,
})

export const siteEngineerSite = matrix('site_engineer', {
  progress: { actions: ['read', 'submit'], transitions: ['daily_log.submit', 'daily_report.submit', 'submission.submit'] },
  schedule: { actions: ['read'] },
  lookahead: { actions: ['read', 'update'], transitions: ['lookahead.item_status'] },
  document_control: { actions: ['read', 'create'] },
  timesheet: { actions: ['read', 'create', 'update', 'submit'], transitions: ['timesheet.submit'] },
  rfi: { actions: ['read', 'create'] },
})

export const pmSite = matrix('pm', {
  progress: { actions: ['read', 'create', 'update', 'submit', 'approve'], transitions: ['daily_log.submit', 'daily_log.update', 'daily_log.approve', 'submission.submit', 'submission.approve'] },
  schedule: { actions: ['read', 'create', 'update'] },
  lookahead: { actions: ['read', 'create', 'update', 'submit'], transitions: ['lookahead.item_status', 'lookahead.publish'] },
  document_control: { actions: ['read', 'create', 'update'] },
  timesheet: { actions: ['read', 'create', 'update', 'submit', 'approve'], transitions: ['timesheet.submit', 'timesheet.approve'] },
  rfi: { actions: ['read', 'create'] },
  task: { actions: ['read'] },
})

// ── PC-6: quantities installed ──

/** A member who reads progress but may not submit it: no entry form, no Add. */
export const financeSite = matrix('finance', {
  progress: { actions: ['read'] },
  schedule: { actions: ['read'] },
})

/** The allocation register's answer for a1: two approved allocations, as the server lists them (only what the picker reads). */
/** GET /projects/p1/activities/a1/allocated-items as a member who may read the BOQ gets it (the server's picker). */
export const allocationsOfA1 = {
  activityId: 'a1',
  activity: { id: 'a1', name: 'Pour raft', code: 'A100' },
  items: [
    { id: 'b1', code: 'C-030', description: 'Concrete C30 to raft', unit: 'm3', unitCode: 'm3', allocationId: 'al1', allocationIds: ['al1'], allocatedQuantity: 480 },
    { id: 'b2', code: null, description: 'Reinforcement to raft', unit: 'kg', unitCode: 'kg', allocationId: 'al2', allocationIds: ['al2'], allocatedQuantity: 12000 },
  ],
}

/** The same picker for a member who may not read the BOQ: id, description and unit — no code, allocation or quantity. */
export const allocationsOfA1Withheld = {
  activityId: 'a1',
  activity: { id: 'a1', name: 'Pour raft', code: 'A100' },
  items: [
    { id: 'b1', description: 'Concrete C30 to raft', unit: 'm3', unitCode: 'm3' },
    { id: 'b2', description: 'Reinforcement to raft', unit: 'kg', unitCode: 'kg' },
  ],
  boqWithheld: { keys: ['code', 'allocationId', 'allocationIds', 'allocatedQuantity'], reason: 'The code, allocation and allocated quantity of an activity’s BOQ items are available only to members who may read the BOQ' },
}

export const quantityEntry = (over: Partial<DailyLogEntry> = {}): DailyLogEntry => ({
  id: 'q1',
  section: 'quantities',
  partyId: null,
  party: null,
  // The row's own review state — a staff row is approved at once — which is never progress approval.
  status: 'approved',
  createdBy: 'u1',
  clientRequestId: 'cq1',
  activityId: 'a1',
  activity: { id: 'a1', name: 'Foundation concrete' },
  boqItemId: 'b1',
  boqItem: { id: 'b1', description: 'Concrete C30 to raft', unitCode: 'm3', code: 'C-030' },
  allocationId: 'al1',
  quantity: 120,
  unitCode: 'm3',
  locationId: null,
  location: null,
  notes: null,
  progressEntry: { id: 'qpe1', status: 'submitted', source: 'daily_log' },
  createdAt: `${today}T09:00:00.000Z`,
  ...over,
})
