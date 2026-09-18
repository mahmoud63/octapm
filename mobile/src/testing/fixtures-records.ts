/** Record fixtures for the M2 tests, shaped like the live API answers of 2026-09-18. */
import type { DrawingSheet, RegisterRow, RfiDetail, RfiList, RfiRow, TaskDetail, TaskList, TaskRow } from '@/api/record-types'
import { matrix } from '@/testing/fixtures'

export const rfiRow = (over: Partial<RfiRow> = {}): RfiRow => ({
  id: 'r1',
  projectId: 'p1',
  ref: 'RFI-001',
  subject: 'Founding level at grid A-D',
  question: 'Borehole BH-3 shows the competent stratum 150mm below the founding level. Lower the level or thicken the pad?',
  response: null,
  discipline: 'structural',
  priority: 'high',
  status: 'open',
  specSection: null,
  locationId: 'l1',
  activityId: 'a1',
  managerUserId: 'u1',
  assigneeUserId: null,
  ballInCourtUserId: 'u3',
  costImpact: false,
  costImpactAmount: null,
  scheduleImpactFlag: true,
  scheduleImpact: 3,
  raisedDate: '2026-09-12T00:00:00.000Z',
  dueDate: '2030-01-20T12:00:00.000Z',
  responseRequiredBy: '2030-01-20T12:00:00.000Z',
  answeredDate: null,
  revision: 0,
  changeOrderId: null,
  createdBy: 'u2',
  createdAt: '2026-09-12T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z',
  ...over,
})

export const rfiDetail = (over: Partial<RfiDetail> = {}): RfiDetail => ({
  ...rfiRow(),
  manager: { id: 'u1', name: 'Dana Okafor' },
  location: { id: 'l1', name: 'Foundation zone, grid A-D' },
  activity: { id: 'a1', name: 'Foundation concrete', activityCode: 'A130' },
  assignees: [{ id: 'u3', name: 'Ravi Menon' }],
  distribution: [{ id: 'u4', name: 'Sofia Lindqvist' }],
  ballInCourtUser: { id: 'u3', name: 'Ravi Menon' },
  responses: [],
  officialResponse: null,
  attachments: [],
  isOverdue: false,
  path: '/projects/p1/doc-control/rfi?recordId=r1&source=rfi',
  ...over,
})

export const answeredRfi = (): RfiDetail => {
  const official = { id: 'resp1', rfiId: 'r1', body: 'Lower the founding level by 150mm at grid A-D.', isOfficial: true, revision: 0, authorId: 'u3', author: { id: 'u3', name: 'Ravi Menon' }, createdAt: '2026-09-13T00:00:00.000Z', updatedAt: '2026-09-13T00:00:00.000Z' }
  return rfiDetail({ status: 'answered', responses: [official], officialResponse: official, answeredDate: '2026-09-13T00:00:00.000Z' })
}

export const rfiList = (rows: RfiRow[] = [rfiRow(), rfiRow({ id: 'r2', ref: 'RFI-002', subject: 'Rebar cover at the lift pit', status: 'closed', priority: 'normal', ballInCourtUserId: null })]): RfiList => ({
  rows,
  summary: { draft: 0, open: 1, answered: 0, closed: 1, archived: 0, scheduleImpactDays: 3 },
  pagination: { limit: 50, nextCursor: null },
})

export const taskRow = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: 't1',
  projectId: 'p1',
  project: { id: 'p1', name: 'Riverside Tower' },
  activityId: 'a1',
  activity: { id: 'a1', name: 'Foundation concrete', activityCode: 'A130' },
  taskNumber: 'TSK-0001',
  title: 'Re-brief lifting plan to the steelfixing crew',
  description: 'From meeting MTG-0001.',
  label: 'action',
  priority: 'high',
  status: 'todo',
  dueDate: '2030-02-05T12:00:00.000Z',
  isOverdue: false,
  assigneeId: 'u1',
  assignee: { id: 'u1', name: 'Dana Okafor' },
  assigneeName: 'Dana Okafor',
  createdBy: { id: 'u3', name: 'Ravi Menon' },
  closedAt: null,
  commentCount: 1,
  attachmentCount: 0,
  createdAt: '2026-09-12T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z',
  ...over,
})

export const taskDetail = (over: Partial<TaskDetail> = {}): TaskDetail => ({
  ...taskRow(),
  comments: [{ id: 'tc1', taskId: 't1', body: 'Created from meeting MTG-0001.', authorId: 'u3', author: { id: 'u3', name: 'Ravi Menon' }, createdAt: '2026-09-12T00:00:00.000Z' }],
  history: [{ id: 'th1', action: 'created', actor: { id: 'u3', name: 'Ravi Menon' }, actorRole: 'planning_eng', fromStatus: null, toStatus: 'todo', comment: null, createdAt: '2026-09-12T00:00:00.000Z' }],
  ...over,
})

export const taskList = (rows: TaskRow[] = [taskRow(), taskRow({ id: 't2', taskNumber: 'TSK-0002', title: 'Chase the rebar mill certificates', status: 'done', priority: 'medium', assigneeName: 'Priya Raman' })]): TaskList => ({
  rows,
  pagination: { limit: 50, nextCursor: null },
  summary: { open: 1, overdue: 0 },
})

export const registerRows: RegisterRow[] = [
  { id: 'rfi:r1', recordType: 'rfi', recordId: 'r1', ref: 'RFI-001', title: 'Founding level at grid A-D', documentNumber: 'RFI-001', category: 'RFI', folderPath: '/RFI', folderKey: 'rfi', status: 'open', currentRevision: null, latestRevision: null },
  {
    id: 'drawing:d1',
    recordType: 'drawing',
    recordId: 'd1',
    ref: 'DWG-001',
    title: 'S-101 Foundation plan',
    documentNumber: 'S-101',
    category: 'Structural',
    folderPath: '/Drawings',
    folderKey: 'drawings',
    status: 'approved',
    currentRevision: { id: 'rev1', revision: 'B', status: 'approved', title: 'S-101 Foundation plan', fileName: 'S-101-B.pdf', mimeType: 'application/pdf', sizeBytes: 240000 },
    latestRevision: { id: 'rev1', revision: 'B', status: 'approved', title: 'S-101 Foundation plan', fileName: 'S-101-B.pdf', mimeType: 'application/pdf', sizeBytes: 240000 },
  },
]

export const register = { rows: registerRows, folders: [{ key: 'all', label: 'All documents', recordTypes: ['rfi', 'drawing'], count: 2 }, { key: 'drawings', label: 'Drawings', recordTypes: ['drawing'], count: 1 }], summary: { records: 2, latestApproved: 1, supersededRevisions: 0, missingRevision: 1 } }

export const sheet = (over: Partial<DrawingSheet> = {}): DrawingSheet => ({
  id: 's1',
  setId: 'set1',
  number: 'S-101',
  title: 'Foundation plan',
  discipline: 'structural',
  status: 'current',
  locationId: 'l1',
  currentRevisionId: 'sr1',
  currentRevision: { id: 'sr1', revision: 'B', status: 'published', pageNumber: 3, documentId: 'doc1', fileUrl: '/api/v1/projects/p1/attachments/documents/doc1', publishedAt: '2026-09-10T00:00:00.000Z' },
  ...over,
})

export const sheetList = { items: [sheet(), sheet({ id: 's2', number: 'A-201', title: 'Level 2 plan', discipline: 'architectural', status: 'obsolete', currentRevision: { id: 'sr2', revision: 'A', status: 'superseded', pageNumber: 1, documentId: 'doc2', fileUrl: null, publishedAt: null } })], summary: { total: 2, current: 1, obsolete: 1, disciplines: ['structural', 'architectural'] } }

export const pmFull = matrix('pm', {
  rfi: { actions: ['read', 'create', 'update', 'delete', 'submit', 'approve', 'export'], transitions: ['rfi.submit', 'rfi.answer', 'rfi.close', 'rfi.reopen', 'rfi.approve', 'rfi.reject'] },
  task: { actions: ['read', 'create', 'update', 'delete', 'submit'], transitions: ['task.assign', 'task.close', 'task.comment'] },
  document_control: { actions: ['read', 'create', 'update', 'submit', 'approve'], transitions: ['drawing.publish'] },
  change_order: { actions: ['read', 'create', 'update', 'submit', 'approve'] },
  punch: { actions: ['read', 'create'] },
  progress: { actions: ['read', 'submit'] },
  inspection: { actions: ['read', 'create'] },
  inventory: { actions: ['read'] },
})

export const siteEngineer = matrix('site_engineer', {
  rfi: { actions: ['read', 'create', 'update', 'submit'], transitions: ['rfi.submit', 'rfi.answer'] },
  task: { actions: ['read', 'create', 'update', 'submit'], transitions: ['task.assign', 'task.close', 'task.comment'] },
  document_control: { actions: ['read', 'submit'] },
})

export const warehouse = matrix('warehouse', {
  rfi: { actions: ['read'] },
  task: { actions: ['read', 'submit'], transitions: ['task.comment'] },
  document_control: { actions: ['read'] },
  inventory: { actions: ['read', 'create', 'update', 'submit'] },
})
