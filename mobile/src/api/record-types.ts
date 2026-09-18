/**
 * Shapes of the records the app shows from M2: RFIs, tasks, comments,
 * history, attachments, people and place pickers, the document register and
 * drawing sheets. Checked against live responses from the local API on
 * 2026-09-18 (docs/mobile/OCTAPM_MOBILE_API_MAP.md §3.4, §3.5, §4.1, §4.2,
 * §4.8). Fields the app does not use are left out.
 */

export interface Person {
  id: string
  name: string
  email?: string | null
  role?: string | null
}

export interface Named {
  id: string
  name: string
  code?: string | null
  activityCode?: string | null
}

export type RfiStatus = 'draft' | 'open' | 'answered' | 'closed' | 'archived'
export type RfiPriority = 'low' | 'normal' | 'high' | 'urgent'

export const RFI_STATUSES: readonly RfiStatus[] = ['draft', 'open', 'answered', 'closed']
export const RFI_PRIORITIES: readonly RfiPriority[] = ['low', 'normal', 'high', 'urgent']
export const DISCIPLINES = ['architectural', 'structural', 'civil', 'mechanical', 'electrical', 'plumbing', 'fire', 'landscape', 'other'] as const

export interface RfiRow {
  id: string
  projectId: string
  ref: string
  subject: string
  question: string | null
  response: string | null
  discipline: string | null
  priority: RfiPriority | string
  status: RfiStatus | string
  specSection: string | null
  locationId: string | null
  activityId: string | null
  managerUserId: string | null
  assigneeUserId: string | null
  ballInCourtUserId: string | null
  costImpact: boolean | null
  costImpactAmount: number | null
  scheduleImpactFlag: boolean | null
  scheduleImpact: number | null
  raisedDate: string | null
  dueDate: string | null
  responseRequiredBy: string | null
  answeredDate: string | null
  revision: number
  changeOrderId: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface RfiResponse {
  id: string
  rfiId: string
  body: string
  isOfficial: boolean
  revision: number
  authorId: string | null
  author: Person | null
  createdAt: string
  updatedAt: string
}

export interface RfiDetail extends RfiRow {
  manager: Person | null
  location: Named | null
  activity: Named | null
  assignees: (Person & { userId?: string })[]
  distribution: (Person & { userId?: string })[]
  ballInCourtUser: Person | null
  responses: RfiResponse[]
  officialResponse: RfiResponse | null
  attachments: AttachmentItem[]
  isOverdue: boolean
  /** Web-platform path for this record. */
  path: string
}

export interface RfiList {
  rows: RfiRow[]
  summary: { draft: number; open: number; answered: number; closed: number; archived: number; scheduleImpactDays: number }
  pagination: { limit: number; nextCursor: string | null }
}

export interface RfiCreate {
  subject: string
  question?: string
  priority?: RfiPriority
  status?: 'draft' | 'open'
  discipline?: string
  specSection?: string
  managerUserId?: string
  assigneeUserIds?: string[]
  distributionUserIds?: string[]
  locationId?: string
  activityId?: string
  responseRequiredBy?: string
  dueDate?: string
  costImpact?: boolean
  costImpactAmount?: number
  scheduleImpactFlag?: boolean
  scheduleImpact?: number
}

export type RfiAction = 'submit' | 'answer' | 'approve' | 'reject' | 'close' | 'reopen'

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'canceled'
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical'
export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done', 'canceled']
export const TASK_LABELS = ['action', 'field', 'procurement', 'quality', 'safety', 'commercial', 'document'] as const

export interface TaskRow {
  id: string
  projectId: string | null
  project: Named | null
  activityId: string | null
  activity: Named | null
  taskNumber: string
  title: string
  description: string | null
  label: string | null
  priority: TaskPriority | string
  status: TaskStatus | string
  dueDate: string | null
  isOverdue: boolean
  assigneeId: string | null
  assignee: Person | null
  assigneeName: string | null
  createdBy: Person | null
  closedAt: string | null
  commentCount: number
  attachmentCount: number
  createdAt: string
  updatedAt: string
}

export interface TaskComment {
  id: string
  taskId: string
  body: string
  authorId: string | null
  author: Person | null
  createdAt: string
}

export interface TaskHistoryEvent {
  id: string
  action: string
  actor: Person | null
  actorRole: string | null
  fromStatus: string | null
  toStatus: string | null
  comment: string | null
  createdAt?: string
  occurredAt?: string
}

export interface TaskDetail extends TaskRow {
  comments: TaskComment[]
  history: TaskHistoryEvent[]
}

export interface TaskList {
  rows: TaskRow[]
  pagination: { limit: number; nextCursor: string | null }
  summary: { open: number; overdue: number }
}

export interface TaskCreate {
  title: string
  description?: string
  label?: string
  priority?: TaskPriority
  status?: TaskStatus
  dueDate?: string
  projectId?: string
  activityId?: string
  assigneeId?: string
}

export interface Comment {
  id: string
  recordType: string
  recordId: string
  parentId: string | null
  body: string
  author: Person | null
  authorId: string | null
  editedAt: string | null
  deletedAt: string | null
  createdAt: string
  canEdit?: boolean
  canDelete?: boolean
}

export interface CommentsPage {
  items: Comment[]
  pagination: { limit: number; nextCursor: string | null }
}

export interface AuditEvent {
  id: string
  source: string
  entityType: string
  entityId: string
  action: string
  decision: string | null
  actorId: string | null
  actorName: string | null
  actorRole: string | null
  occurredAt: string
  fromStatus: string | null
  toStatus: string | null
  reason: string | null
  comment: string | null
}

export interface AuditPage {
  events: AuditEvent[]
  nextCursor: string | null
}

export interface TeamMember {
  userId: string
  name: string
  email: string | null
  orgRole: string | null
  assignmentRole: string | null
  status: string
  party: { id: string; name: string } | null
}

export interface LocationNode {
  id: string
  parentId: string | null
  name: string
  code: string | null
  kind: string | null
  fullName: string
  depth: number
  status: string
  childCount: number
}

export interface ActivityRow {
  id: string
  name: string
  activityCode: string | null
  wbsCode: string | null
  status: string
  startDate: string | null
  endDate: string | null
  pctComplete: number | null
  isCritical: boolean
  isMilestone: boolean
}

export interface AttachmentItem {
  id: string
  recordType: string
  recordId: string
  documentId: string | null
  role: string
  caption: string | null
  source: string | null
  uploadedBy: Person | string | null
  createdAt: string
  fileName: string | null
  /** API path of the file (a redirect to a presigned URL); needs the bearer. */
  fileUrl: string | null
  mimeType: string | null
  sizeBytes: number | null
  photo: { id: string; thumbnailUrl?: string | null; width?: number | null; height?: number | null } | null
}

export interface RegisterRevision {
  id: string
  revision: string
  status: string
  title: string | null
  fileName?: string | null
  mimeType: string | null
  sizeBytes: number | null
  createdAt?: string
}

export interface RegisterRow {
  id: string
  recordType: string
  recordId: string
  ref: string | null
  title: string
  documentNumber: string | null
  category: string | null
  folderPath: string | null
  folderKey: string | null
  status: string | null
  currentRevision: RegisterRevision | null
  latestRevision: RegisterRevision | null
}

export interface Register {
  rows: RegisterRow[]
  folders: { key: string; label: string; recordTypes: string[]; count: number }[]
  summary: { records: number; latestApproved: number; supersededRevisions: number; missingRevision: number }
}

export interface SheetRevision {
  id: string
  revision: string
  status: 'pending_review' | 'published' | 'superseded' | 'rejected' | string
  pageNumber: number | null
  documentId: string | null
  /** API path of the whole source PDF; needs the bearer. */
  fileUrl: string | null
  publishedAt: string | null
}

export interface DrawingSheet {
  id: string
  setId: string | null
  number: string
  title: string | null
  discipline: string | null
  status: 'current' | 'obsolete' | string
  locationId: string | null
  currentRevisionId: string | null
  currentRevision: SheetRevision | null
  updatedAt?: string
}

export interface SheetList {
  items: DrawingSheet[]
  summary: { total: number; current: number; obsolete: number; disciplines: string[] }
}

export interface ManifestItem {
  sheetId: string
  number: string
  title: string | null
  discipline: string | null
  revisionId: string
  revision: string
  documentId: string
  pageNumber: number | null
  fileUrl: string
  fileName: string | null
  sizeBytes: number | null
  sha256: string | null
  publishedAt: string | null
}

export interface OfflineManifest {
  generatedAt: string
  items: ManifestItem[]
  totals: { sheets: number; documents: number; bytes: number }
}

export interface SheetPin {
  id: string
  sheetId: string
  sheetRevisionId: string | null
  x: number
  y: number
  recordType: string
  recordId: string
  label: string | null
  color: string | null
}

export interface CustomFieldDefinition {
  key: string
  label: string
  type: string
  required?: boolean
  options?: { value: string; label: string }[]
}

export interface CustomFieldSchema {
  recordType: string
  recordTypeLabel: string
  module: string
  fields: CustomFieldDefinition[]
}
