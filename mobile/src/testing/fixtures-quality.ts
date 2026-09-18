/** Quality fixtures for the M4 tests, shaped like the live API of 2026-09-18. */
import type { FormInstance, FormList, FormTemplate, MaterialTest, MaterialTestList, Ncr, NcrList, PunchItem, PunchList, QualityDashboard, SafetyIncident, SafetyList } from '@/api/quality-types'
import { matrix } from '@/testing/fixtures'

export const dashboard: QualityDashboard = {
  metrics: { qualityScore: 57, majorNcrs: 1, minorNcrs: 1, failedItps: 1, openDefects: 4, testsPassed: 6, testsFailed: 1, safetyIncidents: 2, safetyOpen: 1, observationsOpen: 2, dueAlerts: 3, overdue: 2 },
}

export const template = (over: Partial<FormTemplate> = {}): FormTemplate => ({
  id: 't1',
  scope: 'project',
  type: 'itp',
  typeLabel: 'ITP',
  name: 'Concrete pour ITP',
  description: 'Pre-pour checks for structural concrete',
  trade: 'Concrete',
  status: 'active',
  settings: { requireSignatures: [], deficiencyTarget: 'punch_item', instructions: 'Check every item before the pour is released.' },
  sectionCount: 1,
  itemCount: 3,
  holdPointCount: 1,
  ...over,
})

export const templates = [template(), template({ id: 't2', type: 'talk', typeLabel: 'Toolbox talk', name: 'Working at height', trade: null, itemCount: 2, holdPointCount: 0 })]

export const formInstance = (over: Partial<FormInstance> = {}): FormInstance => ({
  id: 'f1',
  ref: 'ITP-001',
  title: 'Concrete pour ITP · Raft grid A-D',
  type: 'itp',
  typeLabel: 'ITP',
  status: 'in_progress',
  outcome: null,
  templateId: 't1',
  template: { id: 't1', name: 'Concrete pour ITP' },
  activityId: 'a1',
  activity: { id: 'a1', name: 'Foundation concrete' },
  locationId: 'l1',
  location: { id: 'l1', name: 'Foundation zone, grid A-D' },
  sheetId: null,
  assigneeUserId: 'u1',
  assigneeUser: { id: 'u1', name: 'Dana Okafor' },
  inspectorUserId: 'u1',
  approverUserId: null,
  ballInCourtUserId: 'u1',
  scheduledFor: null,
  dueDate: '2030-01-10T00:00:00.000Z',
  startedAt: '2026-09-18T06:00:00.000Z',
  completedAt: null,
  closedAt: null,
  isOverdue: false,
  sections: [
    {
      id: 's1',
      title: 'Before the pour',
      description: null,
      items: [
        { id: 'i1', label: 'Formwork clean and oiled', description: null, responseType: 'pass_fail', required: true, photoRequired: false, isHoldPoint: false, inspectionPointType: null, options: null, reference: null, response: { id: 'r1', itemId: 'i1', value: 'pass', note: null } },
        { id: 'i2', label: 'Rebar cover to drawing', description: 'Minimum 50 mm', responseType: 'pass_fail', required: true, photoRequired: false, isHoldPoint: true, inspectionPointType: 'hold', options: null, reference: 'S-201', response: null },
        { id: 'i3', label: 'Slump (mm)', description: null, responseType: 'number', required: false, photoRequired: false, isHoldPoint: false, inspectionPointType: null, options: null, reference: null, response: null },
      ],
    },
  ],
  signatures: [],
  holdPoints: [{ itemId: 'i2', label: 'Rebar cover to drawing', state: 'pending' }],
  ...over,
})

export const formList = (items = [formInstance(), formInstance({ id: 'f2', ref: 'INS-004', title: 'Blockwork level 2', type: 'inspection', typeLabel: 'Inspection', status: 'complete', outcome: 'fail', ballInCourtUserId: 'u2', assigneeUserId: 'u2', assigneeUser: { id: 'u2', name: 'Priya Raman' } })]): FormList => ({
  items,
  summary: { total: items.length, open: 1, overdue: 0, failed: 1, awaitingClose: 1, holdPointsOpen: 1, byStatus: { in_progress: 1, complete: 1 }, byType: { itp: 1, inspection: 1 } },
})

export const punchItem = (over: Partial<PunchItem> = {}): PunchItem => ({
  id: 'pi1',
  projectId: 'p1',
  number: 12,
  ref: 'PL-012',
  title: 'Honeycombing at column C4 base',
  description: 'Exposed aggregate over 300 mm at the kicker.',
  status: 'open',
  priority: 'high',
  trade: 'Concrete',
  activityId: 'a1',
  activity: { id: 'a1', name: 'Foundation concrete' },
  locationId: 'l1',
  location: { id: 'l1', name: 'Foundation zone, grid A-D' },
  locationText: 'Column C4',
  sheetId: null,
  sheet: null,
  assigneeCompanyId: null,
  assigneeCompany: null,
  assigneeUserId: 'u2',
  assigneeUser: { id: 'u2', name: 'Priya Raman' },
  managerUserId: 'u1',
  managerUser: { id: 'u1', name: 'Dana Okafor' },
  finalApproverUserId: null,
  finalApproverUser: null,
  ballInCourtUserId: 'u2',
  ballInCourtUser: { id: 'u2', name: 'Priya Raman' },
  dueDate: '2030-01-10T00:00:00.000Z',
  isOverdue: false,
  daysOverdue: null,
  openedAt: '2026-09-18T06:00:00.000Z',
  readyAt: null,
  closedAt: null,
  reopenCount: 0,
  disputeReason: null,
  kind: 'punch',
  observationType: null,
  observationTypeLabel: null,
  hazard: null,
  contributingCondition: null,
  sourceRecordType: null,
  sourceRecordId: null,
  createdBy: 'u1',
  createdAt: '2026-09-18T06:00:00.000Z',
  updatedAt: '2026-09-18T06:00:00.000Z',
  ...over,
})

export const punchList = (items = [punchItem(), punchItem({ id: 'pi2', number: 13, ref: 'OBS-002', title: 'Unprotected edge at level 3', kind: 'observation', observationType: 'safety', observationTypeLabel: 'Safety', trade: null, priority: 'urgent', status: 'ready_for_review', ballInCourtUserId: 'u1', ballInCourtUser: { id: 'u1', name: 'Dana Okafor' } })]): PunchList => ({
  items,
  summary: { total: items.length, open: 1, overdue: 0, byStatus: { open: 1, ready_for_review: 1 }, byCompany: {}, byTrade: { Concrete: 1 }, byType: { punch: 1, observation: 1 } },
})

export const ncr = (over: Partial<Ncr> = {}): Ncr => ({
  id: 'n1',
  projectId: 'p1',
  activityId: 'a1',
  ref: 'NCR-003',
  status: 'open',
  severity: 'major',
  description: 'Honeycombing in column C4 below the kicker',
  disposition: 'Break out and recast',
  responsible: 'Delta Concrete',
  assigneeUserId: 'u2',
  assigneeUser: { id: 'u2', name: 'Priya Raman' },
  assigneeCompanyId: null,
  assigneeCompany: null,
  ballInCourtUserId: 'u2',
  ballInCourtUser: { id: 'u2', name: 'Priya Raman' },
  dueDate: '2030-01-10T00:00:00.000Z',
  closureComment: null,
  closureSubmittedAt: null,
  closureApprovedAt: null,
  reopenedAt: null,
  closedDate: null,
  attachmentRefs: [],
  activityLinks: [{ activityId: 'a1', activity: { id: 'a1', name: 'Foundation concrete' } }],
  history: [{ id: 'h1', action: 'created', actorName: 'Dana Okafor', fromStatus: null, toStatus: 'open', occurredAt: '2026-09-18T06:00:00.000Z' }],
  createdAt: '2026-09-18T06:00:00.000Z',
  updatedAt: '2026-09-18T06:00:00.000Z',
  ...over,
})

export const ncrList = (rows = [ncr(), ncr({ id: 'n2', ref: 'NCR-004', severity: 'minor', description: 'Blockwork joint thickness over 15 mm', status: 'submitted', closureComment: 'Joints raked and repointed.', closureSubmittedAt: '2026-09-17T10:00:00.000Z', attachmentRefs: [{ id: 'att1', fileName: 'repointed.jpg', fileUrl: '/api/v1/projects/p1/workflow/uploads/k1', mimeType: 'image/jpeg', sizeBytes: 12345 }], ballInCourtUserId: 'u1', ballInCourtUser: { id: 'u1', name: 'Dana Okafor' } })]): NcrList => ({
  rows,
  summary: { open: 1, submitted: 1, closed: 0, major: 1, minor: 1, overdue: 0 },
})

export const incident = (over: Partial<SafetyIncident> = {}): SafetyIncident => ({
  id: 'si1',
  projectId: 'p1',
  activityId: null,
  ref: 'SAF-002',
  status: 'investigating',
  incidentType: 'near_miss',
  severity: 'medium',
  title: 'Scaffold plank slipped at level 3',
  date: '2026-09-17',
  lostDays: 0,
  investigation: 'Plank not tied; toe board missing.',
  responsible: 'Apex Scaffolding',
  assigneeUserId: 'u1',
  assigneeUser: { id: 'u1', name: 'Dana Okafor' },
  assigneeCompanyId: null,
  assigneeCompany: null,
  ballInCourtUserId: 'u1',
  ballInCourtUser: { id: 'u1', name: 'Dana Okafor' },
  dueDate: '2030-01-10T00:00:00.000Z',
  closureComment: null,
  closureSubmittedAt: null,
  closureApprovedAt: null,
  reopenedAt: null,
  closedDate: null,
  attachmentRefs: [],
  activityLinks: [],
  history: [],
  createdAt: '2026-09-17T09:00:00.000Z',
  updatedAt: '2026-09-17T09:00:00.000Z',
  ...over,
})

export const safetyList = (rows = [incident(), incident({ id: 'si2', ref: 'SAF-001', status: 'closed', incidentType: 'first_aid', title: 'Cut hand on rebar tie', date: '2026-09-02', closureComment: 'Gloves reissued; toolbox talk held.', closureApprovedAt: '2026-09-05T00:00:00.000Z', ballInCourtUserId: null, ballInCourtUser: null })]): SafetyList => ({
  rows,
  summary: { open: 0, investigating: 1, submitted: 0, closed: 1, archived: 0, lti: 0, nearMiss: 1, lostDays: 0, overdue: 0 },
})

export const materialTest = (over: Partial<MaterialTest> = {}): MaterialTest => ({
  id: 'mt1',
  projectId: 'p1',
  activityId: 'a1',
  ref: 'MT-007',
  testType: '28-day concrete cube',
  specValue: '40 MPa',
  actualValue: null,
  result: 'pending',
  dueDate: '2030-01-10T00:00:00.000Z',
  testDate: null,
  labName: null,
  millCertRef: null,
  notes: null,
  assigneeUser: null,
  attachmentRefs: [],
  activityLinks: [{ activityId: 'a1', activity: { id: 'a1', name: 'Foundation concrete' } }],
  createdAt: '2026-09-18T06:00:00.000Z',
  updatedAt: '2026-09-18T06:00:00.000Z',
  ...over,
})

export const materialTestList = (rows = [materialTest(), materialTest({ id: 'mt2', ref: 'MT-006', testType: '7-day concrete cube', actualValue: '31 MPa', result: 'pass', testDate: '2026-09-15', labName: 'Gulf Labs' })]): MaterialTestList => ({
  rows,
  summary: { passed: 1, failed: 0, pending: 1, passRate: 100 },
})

export const pmQuality = matrix('pm', {
  inspection: { actions: ['read', 'create', 'update', 'submit', 'approve'], transitions: ['inspection.start', 'inspection.complete', 'inspection.close', 'inspection.reopen', 'inspection.void'] },
  punch: { actions: ['read', 'create', 'update', 'submit', 'approve'], transitions: ['punch.open', 'punch.ready_for_review', 'punch.close', 'punch.reopen', 'punch.dispute', 'punch.void'] },
  ncr: { actions: ['read', 'create', 'update', 'submit', 'approve'], transitions: ['ncr.submit', 'ncr.approve', 'ncr.reject', 'ncr.reopen'] },
  safety: { actions: ['read', 'create', 'update', 'submit', 'approve'], transitions: ['safety.submit', 'safety.approve', 'safety.reject', 'safety.reopen'] },
  progress: { actions: ['read'] },
  schedule: { actions: ['read'] },
  document_control: { actions: ['read', 'create'] },
})

export const siteEngineerQuality = matrix('site_engineer', {
  inspection: { actions: ['read', 'create', 'submit'], transitions: ['inspection.start', 'inspection.complete'] },
  punch: { actions: ['read', 'create', 'submit'], transitions: ['punch.open', 'punch.ready_for_review'] },
  ncr: { actions: ['read'], transitions: [] },
  safety: { actions: ['read', 'create'], transitions: [] },
  schedule: { actions: ['read'] },
  document_control: { actions: ['read', 'create'] },
})
