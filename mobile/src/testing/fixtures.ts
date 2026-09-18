/**
 * Records the M1 tests share, shaped exactly like the live API answers
 * sampled on 2026-09-18.
 */
import type { AssignmentItem, Health, Notification, NotificationPreference, Page, PermissionMatrix, Project, SearchItem } from '@/api/types'

export const user = { id: 'u1', orgId: 'o1', name: 'Dana Okafor', email: 'pm@octapm.demo', role: 'pm', isCompanyAdmin: true, status: 'active' }

export const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  orgId: 'o1',
  name: 'Riverside Tower',
  type: 'building',
  location: 'Riyadh',
  clientName: 'Meridian Property Group',
  consultantName: null,
  contractorName: 'OctaPM Demo Contracting',
  contractType: 'unit_rate',
  contractNumber: 'RT-001',
  startDate: '2026-01-12T00:00:00.000Z',
  endDate: '2026-11-27T00:00:00.000Z',
  contractValue: 9290000,
  currency: 'USD',
  status: 'active',
  archivedAt: null,
  effectiveRole: 'pm',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
})

export const projects = [project(), project({ id: 'p2', name: 'Harbour Bridge', contractNumber: 'HB-002', location: 'Jeddah' })]

export const page = <T>(items: T[]): Page<T> => ({ items, pagination: { limit: 100, nextCursor: null } })

export const assignment = (over: Partial<AssignmentItem> = {}): AssignmentItem => ({
  recordType: 'rfi',
  label: 'RFI',
  recordId: 'r1',
  ref: 'RFI-001',
  title: 'Founding level at grid A-D',
  status: 'open',
  projectId: 'p1',
  projectName: 'Riverside Tower',
  roles: ['assignee'],
  ballInCourt: false,
  dueDate: '2030-01-10T12:00:00.000Z',
  overdue: false,
  updatedAt: '2026-09-10T00:00:00.000Z',
  target: { projectId: 'p1', module: 'docControl', child: 'rfi', recordType: 'rfi', source: 'rfi', recordId: 'r1' },
  ...over,
})

export const assignments = {
  items: [
    assignment({ recordId: 'r1', ref: 'RFI-001', title: 'Founding level at grid A-D', ballInCourt: true }),
    assignment({ recordId: 'n1', recordType: 'ncr', label: 'NCR', ref: 'NCR-003', title: 'Honeycombing in column C4', status: 'submitted', overdue: true, dueDate: '2020-01-01T12:00:00.000Z', target: { projectId: 'p1', module: 'quality', child: 'ncr', recordType: 'ncr', recordId: 'n1' } }),
    assignment({ recordId: 's1', recordType: 'submittal', label: 'Submittal', ref: 'SUB-007', title: 'Rebar mill certificates', status: 'under_review', target: { projectId: 'p1', module: 'docControl', child: 'submittals', recordType: 'submittal', recordId: 's1' } }),
  ],
  summary: { total: 3, overdue: 1, ballInCourt: 1, byType: { rfi: 1, ncr: 1, submittal: 1 } },
}

export const health: Health = {
  generatedAt: '2026-09-18T06:00:00.000Z',
  overallScore: 71,
  dimensions: [
    { key: 'schedule', label: 'Schedule', score: 60 },
    { key: 'cost', label: 'Cost', score: 60 },
    { key: 'commercial', label: 'Commercial', score: 43 },
    { key: 'supplyChain', label: 'Supply Chain', score: 92 },
    { key: 'quality', label: 'Quality', score: 45 },
    { key: 'safety', label: 'Safety', score: 100 },
    { key: 'docControl', label: 'Doc Control', score: 100 },
  ],
  pendingReview: { total: 2, metrics: [{ key: 'progressSubmissions', label: 'Progress submissions', count: 2 }] },
}

export const notification = (over: Partial<Notification> = {}): Notification => ({
  id: 'n1',
  projectId: 'p1',
  type: 'workflow',
  category: 'approval',
  event: 'workflow.submitted',
  title: 'Change order VO-01 needs approval',
  message: 'Status moved to pending.',
  priority: 'high',
  status: 'unread',
  readAt: null,
  archivedAt: null,
  dueAt: null,
  actionUrl: '/projects/p1/commercial/change-orders?recordId=co1&source=change_order',
  entityType: 'change_order',
  entityId: 'co1',
  metadata: {},
  createdAt: '2026-09-18T05:00:00.000Z',
  ...over,
})

export const preferences: NotificationPreference[] = [
  { id: 'pref1', category: 'approval', inAppEnabled: true, emailEnabled: true, pushEnabled: true, digestEnabled: false, dueSoonDays: 3, quietHoursStart: null, quietHoursEnd: null },
  { id: 'pref2', category: 'assignment', inAppEnabled: true, emailEnabled: false, pushEnabled: false, digestEnabled: false, dueSoonDays: 3, quietHoursStart: null, quietHoursEnd: null },
]

export const searchItem = (over: Partial<SearchItem> = {}): SearchItem => ({
  id: 'r1',
  type: 'rfi',
  typeLabel: 'RFI',
  module: 'docControl',
  projectId: 'p1',
  projectName: 'Riverside Tower',
  title: 'Founding level at grid A-D against borehole BH-3',
  subtitle: 'Priority high',
  identifier: 'RFI-001',
  status: 'closed',
  date: '2026-09-12T17:59:11.088Z',
  url: '/projects/p1?module=docControl&child=rfi&recordId=r1&status=closed&source=rfi',
  score: 95,
  ...over,
})

export const matrix = (role: string, modules: Record<string, { actions: string[]; transitions?: string[]; visible?: boolean }>): PermissionMatrix => ({
  orgId: 'o1',
  projectId: 'p1',
  userId: 'u1',
  isCompanyAdmin: false,
  source: 'assignment',
  role,
  partyRoles: [],
  template: null,
  modules: Object.fromEntries(Object.entries(modules).map(([key, m]) => [key, { label: key, level: 'standard', visible: m.visible ?? true, actions: m.actions, transitions: m.transitions ?? [] }])),
})

export const pmMatrix = matrix('pm', {
  rfi: { actions: ['read', 'create', 'update', 'submit', 'approve'], transitions: ['rfi.submit', 'rfi.answer', 'rfi.close'] },
  punch: { actions: ['read', 'create', 'update', 'submit', 'approve'] },
  document_control: { actions: ['read', 'create', 'update'] },
  progress: { actions: ['read', 'submit', 'approve'] },
  inspection: { actions: ['read', 'create', 'submit'] },
  inventory: { actions: ['read', 'create', 'update', 'submit'] },
  ncr: { actions: ['read', 'create', 'approve'] },
})
