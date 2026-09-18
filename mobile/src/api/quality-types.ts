/**
 * Shapes for the quality screens (M4): the dashboard, inspection templates
 * and instances, punch items and observations, NCRs, safety incidents and
 * material tests. Checked against live responses on 2026-09-18 (map §4.3).
 */
import type { Named, Person } from '@/api/record-types'

export interface QualityDashboard {
  metrics: {
    qualityScore: number | null
    majorNcrs: number
    minorNcrs: number
    failedItps: number
    openDefects: number
    testsPassed: number
    testsFailed: number
    safetyIncidents: number
    safetyOpen: number
    observationsOpen: number
    dueAlerts: number
    overdue: number
  }
}

export type ResponseType = 'pass_fail' | 'yes_no' | 'number' | 'text' | 'options' | 'photo' | 'signature' | 'date' | string

export interface TemplateItem {
  id: string
  sectionId?: string
  sortOrder?: number
  label: string
  description: string | null
  responseType: ResponseType
  required: boolean
  photoRequired: boolean
  isHoldPoint: boolean
  inspectionPointType: string | null
  options: string[] | { value: string; label: string }[] | null
  reference: string | null
}

export interface TemplateSection {
  id: string
  title: string
  description: string | null
  sortOrder?: number
  items: TemplateItem[]
}

export interface FormTemplate {
  id: string
  scope: 'project' | 'company' | string
  type: 'inspection' | 'itp' | 'form' | 'talk' | string
  typeLabel: string
  name: string
  description: string | null
  trade: string | null
  status: string
  settings: { requireSignatures?: string[]; deficiencyTarget?: string; instructions?: string | null } | null
  sectionCount: number
  itemCount: number
  holdPointCount: number
  sections?: TemplateSection[]
}

export interface ItemResponse {
  id: string
  itemId?: string
  value: string | number | boolean | null
  note: string | null
  status?: string | null
  answeredAt?: string | null
}

export interface InstanceItem extends TemplateItem {
  response: ItemResponse | null
  signature?: { id: string; signerName: string | null; role: string; createdAt: string } | null
}

export interface InstanceSection {
  id: string
  title: string
  description?: string | null
  items: InstanceItem[]
}

export type FormStatus = 'scheduled' | 'in_progress' | 'complete' | 'closed' | 'void' | string

export interface FormInstance {
  id: string
  ref: string
  title: string
  type: string
  typeLabel?: string
  status: FormStatus
  outcome: 'pass' | 'fail' | null
  templateId: string | null
  template?: { id: string; name: string } | null
  activityId: string | null
  activity: Named | null
  locationId: string | null
  location: Named | null
  sheetId: string | null
  assigneeUserId: string | null
  assigneeUser: Person | null
  inspectorUserId: string | null
  approverUserId: string | null
  ballInCourtUserId?: string | null
  scheduledFor: string | null
  dueDate: string | null
  startedAt: string | null
  completedAt: string | null
  closedAt: string | null
  isOverdue?: boolean
  sections: InstanceSection[]
  signatures: { id: string; role: string; signerName: string | null; createdAt: string }[]
  holdPoints: { itemId: string; label: string; state: string }[]
  path?: string
}

export interface FormList {
  items: FormInstance[]
  summary: { total: number; open: number; overdue: number; failed: number; awaitingClose: number; holdPointsOpen: number; byStatus: Record<string, number>; byType: Record<string, number> }
}

export interface FormCreate {
  templateId: string
  title?: string
  activityId?: string
  locationId?: string
  sheetId?: string
  assigneeUserId?: string
  scheduledFor?: string
  dueDate?: string
  startNow?: boolean
  clientRequestId: string
  clientCreatedAt?: string
  deviceId?: string
}

export type PunchStatus = 'draft' | 'open' | 'ready_for_review' | 'closed' | 'in_dispute' | 'void' | string
export type PunchAction = 'open' | 'ready_for_review' | 'close' | 'reopen' | 'dispute' | 'resolve_dispute' | 'void'
export const PUNCH_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const OBSERVATION_TYPES = ['safety', 'quality', 'commissioning', 'work_to_complete', 'environmental'] as const

export interface PunchItem {
  id: string
  projectId: string
  number: number
  ref: string
  title: string
  description: string | null
  status: PunchStatus
  priority: string
  trade: string | null
  activityId: string | null
  activity: Named | null
  locationId: string | null
  location: Named | null
  locationText: string | null
  sheetId: string | null
  sheet: { id: string; number?: string; title?: string | null } | null
  assigneeCompanyId: string | null
  assigneeCompany: Named | null
  assigneeUserId: string | null
  assigneeUser: Person | null
  managerUserId: string | null
  managerUser: Person | null
  finalApproverUserId: string | null
  finalApproverUser: Person | null
  ballInCourtUserId: string | null
  ballInCourtUser: Person | null
  dueDate: string | null
  isOverdue: boolean
  daysOverdue: number | null
  openedAt: string | null
  readyAt: string | null
  closedAt: string | null
  reopenCount: number
  disputeReason: string | null
  kind: 'punch' | 'observation' | string
  observationType: string | null
  observationTypeLabel: string | null
  hazard: string | null
  contributingCondition: string | null
  sourceRecordType: string | null
  sourceRecordId: string | null
  createdBy: string | Person | null
  createdAt: string
  updatedAt: string
}

export interface PunchList {
  items: PunchItem[]
  summary: { total: number; open: number; overdue: number; byStatus: Record<string, number>; byCompany: Record<string, number>; byTrade: Record<string, number>; byType: Record<string, number> }
}

export interface PunchCreate {
  title: string
  description?: string
  priority?: string
  kind?: 'punch' | 'observation'
  observationType?: string
  hazard?: string
  contributingCondition?: string
  trade?: string
  locationText?: string
  locationId?: string
  sheetId?: string
  activityId?: string
  assigneeCompanyId?: string
  assigneeUserId?: string
  managerUserId?: string
  finalApproverUserId?: string
  dueDate?: string
  status?: 'draft' | 'open'
  clientRequestId: string
}

export type NcrStatus = 'open' | 'submitted' | 'closed' | string

export interface WorkflowRecordBase {
  id: string
  projectId: string
  activityId: string | null
  ref: string
  status: string
  responsible: string | null
  assigneeUserId: string | null
  assigneeUser: Person | null
  assigneeCompanyId: string | null
  assigneeCompany: Named | null
  ballInCourtUserId: string | null
  ballInCourtUser: Person | null
  dueDate: string | null
  closureComment: string | null
  closureSubmittedAt: string | null
  closureApprovedAt: string | null
  reopenedAt: string | null
  closedDate: string | null
  attachmentRefs: AttachmentRef[]
  activityLinks: { activityId: string; activity?: Named | null }[]
  history: { id: string; action: string; actorName?: string | null; actorId?: string | null; fromStatus?: string | null; toStatus?: string | null; comment?: string | null; reason?: string | null; createdAt?: string; occurredAt?: string }[]
  createdAt: string
  updatedAt: string
}

export interface AttachmentRef {
  id?: string
  fileName: string | null
  fileUrl: string | null
  url?: string | null
  storageKey?: string | null
  key?: string | null
  mimeType: string | null
  sizeBytes: number | null
  documentId?: string | null
  createdAt?: string
}

export interface Ncr extends WorkflowRecordBase {
  severity: 'major' | 'minor' | string
  description: string | null
  disposition: string | null
}

export interface NcrList {
  rows: Ncr[]
  summary: { open: number; submitted: number; closed: number; major: number; minor: number; overdue: number }
}

export interface NcrCreate {
  severity: 'major' | 'minor'
  description: string
  disposition?: string
  responsible?: string
  assigneeUserId?: string
  assigneeCompanyId?: string
  dueDate?: string
  activityId?: string
}

export const INCIDENT_TYPES = ['near_miss', 'first_aid', 'lti', 'fatality'] as const
export type SafetyStatus = 'open' | 'investigating' | 'submitted' | 'closed' | 'archived' | string

export interface SafetyIncident extends WorkflowRecordBase {
  incidentType: string
  severity: string | null
  title: string
  date: string | null
  lostDays: number | null
  investigation: string | null
}

export interface SafetyList {
  rows: SafetyIncident[]
  summary: { open: number; investigating: number; submitted: number; closed: number; archived: number; lti: number; nearMiss: number; lostDays: number; overdue: number }
}

export interface SafetyCreate {
  incidentType: string
  title: string
  severity?: string
  date?: string
  dueDate?: string
  lostDays?: number
  status?: 'open' | 'investigating'
  responsible?: string
  investigation?: string
  assigneeUserId?: string
  activityId?: string
}

export interface CloseoutInput {
  closureComment: string
  responsible?: string
  dueDate?: string
  attachmentRefs: AttachmentRef[]
}

export interface MaterialTest {
  id: string
  projectId: string
  activityId: string | null
  ref: string
  testType: string
  specValue: string | null
  actualValue: string | null
  result: 'pass' | 'fail' | 'pending' | string
  dueDate: string | null
  testDate: string | null
  labName: string | null
  millCertRef: string | null
  notes: string | null
  assigneeUser: Person | null
  attachmentRefs: AttachmentRef[]
  activityLinks: { activityId: string; activity?: Named | null }[]
  createdAt: string
  updatedAt: string
}

export interface MaterialTestList {
  rows: MaterialTest[]
  summary: { passed: number; failed: number; pending: number; passRate: number | null }
}

export interface WorkflowUpload {
  documentId: string
  key: string
  storageKey: string
  url: string
  fileUrl: string
  fileName: string
  mimeType: string
  sizeBytes: number
}
