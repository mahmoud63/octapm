/**
 * Response shapes the app relies on where the OpenAPI spec is not specific.
 *
 * Each one was checked against a live response from the local API on
 * 2026-09-18 (see docs/mobile/OCTAPM_MOBILE_API_MAP.md). When the spec gains a
 * schema for one of these, the generated type replaces it and this file
 * shrinks. Fields the app does not use are left out on purpose.
 */

export interface Page<T> {
  items: T[]
  pagination: { limit: number; nextCursor: string | null }
}

export interface Project {
  id: string
  orgId: string
  name: string
  type: string | null
  location: string | null
  clientName: string | null
  consultantName: string | null
  contractorName: string | null
  contractType: string | null
  contractNumber: string | null
  startDate: string | null
  endDate: string | null
  contractValue: number | null
  currency: string | null
  status: string
  archivedAt: string | null
  /** The role the server resolved for the caller on this project. */
  effectiveRole?: string | null
  updatedAt: string
}

/** Where a record lives on the web platform, as the server describes it. */
export interface RecordTarget {
  projectId: string
  module: string
  child?: string | null
  recordType?: string | null
  source?: string | null
  recordId?: string | null
  status?: string | null
}

export interface AssignmentItem {
  recordType: string
  label: string
  recordId: string
  ref: string | null
  title: string
  status: string | null
  projectId: string
  projectName: string
  roles: string[]
  ballInCourt: boolean
  derived?: boolean
  dueDate: string | null
  overdue: boolean
  updatedAt: string
  target: RecordTarget
}

export interface AssignmentSummary {
  total: number
  overdue: number
  ballInCourt: number
  byType: Record<string, number>
}

export interface Assignments {
  items: AssignmentItem[]
  summary: AssignmentSummary
}

export interface HealthDimension {
  key: string
  label: string
  score: number | null
  detail?: unknown
  target?: RecordTarget | null
}

export interface PendingReview {
  total: number
  metrics: { key: string; label: string; count: number }[]
}

export interface Health {
  generatedAt: string
  overallScore: number | null
  dimensions: HealthDimension[]
  pendingReview: PendingReview
}

export interface ProjectHealthRow {
  id: string
  name: string
  status: string
  currency: string | null
  contractValue: number | null
  startDate: string | null
  endDate: string | null
  overallScore: number | null
  dimensions: Record<string, number | null>
  weakestDimension: { key: string; label: string; score: number | null } | null
  spi: number | null
  cpi: number | null
  criticalActivities: number
  delayedActivities: number
  workflowActions: number
  procurementRisks: number
  overdueNcrRfi: number
  openTasks: number
  overdueTasks: number
}

export interface WorkflowQueue {
  key: string
  label: string
  count: number
  description?: string
}

export interface WorkspaceDashboard {
  generatedAt: string
  summary: {
    totalProjects: number
    activeProjects: number
    portfolioHealthScore: number | null
    approvalQueueCount: number
    openTasks: number
    overdueTasks: number
  }
  officialKpis: { key: string; label: string; value: number | null; unit: string | null; detail?: string | null }[]
  healthDimensions: HealthDimension[]
  workflowQueues: WorkflowQueue[]
  projectHealth: ProjectHealthRow[]
  myOpenItems: Assignments
}

export type NotificationStatus = 'unread' | 'read' | 'archived'

export interface Notification {
  id: string
  projectId: string | null
  type: string
  category: string
  event: string
  title: string
  message: string | null
  priority: string
  status: NotificationStatus
  readAt: string | null
  archivedAt: string | null
  dueAt: string | null
  /** A web-platform path; the app either opens the record or hands over. */
  actionUrl: string | null
  entityType: string | null
  entityId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export interface NotificationsPage {
  rows: Notification[]
  pagination: { limit: number; nextCursor: string | null }
}

export interface NotificationSummary {
  unread: number
  read: number
  archived: number
  recent: Notification[]
}

export interface NotificationPreference {
  id?: string
  category: string
  inAppEnabled: boolean
  emailEnabled: boolean
  pushEnabled: boolean
  digestEnabled: boolean
  dueSoonDays: number | null
  quietHoursStart: string | null
  quietHoursEnd: string | null
}

export interface SearchItem {
  id: string
  type: string
  typeLabel: string
  module: string
  projectId: string | null
  projectName: string | null
  title: string
  subtitle: string | null
  identifier: string | null
  status: string | null
  date: string | null
  /** A web-platform path (legacy form); the web router resolves it. */
  url: string
  score: number
}

export interface SearchResponse {
  query: string
  items: SearchItem[]
  groups: { type: string; label: string; count: number }[]
  meta: { limit: number; total: number }
}

export interface PermissionModule {
  label: string
  level: string
  visible: boolean
  actions: string[]
  transitions: string[]
}

export interface PermissionMatrix {
  orgId: string
  projectId: string | null
  userId: string
  isCompanyAdmin: boolean
  source: string
  role: string
  partyRoles: string[]
  template: { id: string; name: string } | null
  modules: Record<string, PermissionModule>
}
