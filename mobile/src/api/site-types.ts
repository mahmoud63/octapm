/**
 * Shapes for the site-reporting and schedule screens (M3): the daily log,
 * activities and progress, lookaheads, photos and timesheets. Checked against
 * live responses from the local API on 2026-09-18 (map §4.6, §4.7, §4.3).
 */
import type { Named, Person } from '@/api/record-types'

export type DailyLogSection = 'manpower' | 'equipment' | 'deliveries' | 'visitors' | 'delays' | 'notes'
export const DAILY_LOG_SECTIONS: readonly DailyLogSection[] = ['manpower', 'equipment', 'deliveries', 'visitors', 'delays', 'notes']
// The server's own nine (daily-log.service.js DELAY_TYPES). Offering a tenth
// only produces a refusal at the end of a form someone has already filled in.
export const DELAY_TYPES = ['weather', 'access', 'design', 'material', 'labour', 'equipment', 'inspection', 'utility', 'other'] as const
// The server's own five (daily-log.service.js NOTE_KINDS).
export const NOTE_KINDS = ['general', 'safety', 'instruction', 'inspection', 'issue'] as const

export interface DailyLogEntry {
  id: string
  section: DailyLogSection
  partyId: string | null
  party: Named | null
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | string
  createdBy: string | Person | null
  clientRequestId: string | null
  // manpower
  companyName?: string | null
  trade?: string | null
  workers?: number | null
  hours?: number | null
  manHours?: number | null
  // equipment
  name?: string | null
  count?: number | null
  hoursOperated?: number | null
  hoursIdle?: number | null
  // deliveries
  supplierName?: string | null
  description?: string | null
  quantity?: number | null
  unit?: string | null
  poRef?: string | null
  receivedBy?: string | null
  deliveredAt?: string | null
  // visitors
  company?: string | null
  purpose?: string | null
  arrivedAt?: string | null
  leftAt?: string | null
  // delays
  type?: string | null
  hoursLost?: number | null
  // notes
  kind?: string | null
  text?: string | null
  // shared
  activityId?: string | null
  activity?: Named | null
  locationId?: string | null
  location?: Named | null
  notes?: string | null
  createdAt?: string
}

export interface DailyLogWeather {
  condition?: string | null
  tempMinC?: number | null
  tempMaxC?: number | null
  /** The server's own names; asking for rainMm or windKph returned nothing at all. */
  precipitationMm?: number | null
  windMaxKph?: number | null
  summary?: string | null
  alerts?: { metric?: string; message?: string }[] | null
}

export interface DailyLog {
  id: string | null
  exists: boolean
  projectId: string
  date: string
  status: 'open' | 'submitted' | 'approved' | string
  weather: DailyLogWeather | null
  weatherSource: string | null
  summary: string | null
  submittedAt: string | null
  submittedBy: string | Person | null
  approvedAt: string | null
  approvedBy: string | Person | null
  sections: Record<DailyLogSection, DailyLogEntry[]>
  totals: { workers: number; manHours: number; companies: number; equipmentCount: number; equipmentHours: number; idleHours: number; deliveries: number; visitors: number; hoursLost: number; notes: number; entries: number; awaitingReview: number }
  path: string
}

export interface DailyLogDay {
  date: string
  status: string
  totals?: Partial<DailyLog['totals']>
  exists?: boolean
}

export interface DailyLogSettings {
  weatherFeedEnabled: boolean
  weatherFeedAvailable: boolean
  hasCoordinates: boolean
  copySections: DailyLogSection[]
}

export type EntryInput = Record<string, string | number | boolean | null | undefined> & { clientRequestId: string }

export type ActivityStatus = 'todo' | 'in_progress' | 'complete' | 'delayed'
export type ProgressMethodKind = 'percent' | 'quantity' | 'weighted_milestone' | 'inspection' | 'manual'

export interface Activity {
  id: string
  projectId: string
  name: string
  activityCode: string | null
  wbsCode: string | null
  category: string | null
  startDate: string | null
  endDate: string | null
  earlyStartDate: string | null
  earlyFinishDate: string | null
  lateFinishDate: string | null
  totalFloat: number | null
  duration: number | null
  /** Absent for a member who may read neither the BOQ nor the cost module (§12). */
  budget?: number | null
  isMilestone: boolean
  isCritical: boolean
  sortOrder: number | null
  /** Approved progress only. */
  pctComplete: number | null
  actualStart: string | null
  actualFinish: string | null
  approvedProgressUpdatedAt: string | null
  progressMethod: ProgressMethodKind | string | null
  pendingProgress: { pctComplete?: number | null; status?: string | null; submittedAt?: string | null } | null
  progressApprovalStatus: 'draft' | 'submitted' | 'approved' | 'missing' | string
  status: ActivityStatus | string
  assignedEngineers: Person[]
}

export interface ProgressMethod {
  activityId: string
  method: ProgressMethodKind | string
  plannedQuantity: number | null
  quantityUnit: string | null
  milestoneWeights: { id: string; name: string; weight: number }[]
  inspectionRequired: boolean
  evidenceRequired: boolean
  notes: string | null
}

export interface ProgressSubmission {
  id: string
  activityId: string
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | string
  pctComplete: number | null
  quantityComplete: number | null
  quantityPlanned: number | null
  quantityUnit: string | null
  progressMethod: string | null
  source: string | null
  notes: string | null
  milestones?: { id: string; name?: string; complete?: boolean; done?: boolean }[] | null
  submittedBy?: Person | string | null
  submittedAt?: string | null
  reviewedAt?: string | null
  rejectionReason?: string | null
  createdAt: string
}

export interface ProgressInput {
  pctComplete?: number
  quantityComplete?: number
  quantityPlanned?: number
  quantityUnit?: string
  milestones?: { id: string; complete: boolean }[]
  inspectionStatus?: 'passed' | 'failed' | 'pending'
  notes?: string
  status: 'draft' | 'submitted'
  source: 'mobile'
  progressMethod?: string
}

export interface Lookahead {
  id: string
  title: string | null
  status: 'draft' | 'published' | 'archived' | string
  startDate: string
  weeks: number
  itemCount?: number
  items?: LookaheadItem[]
}

export interface LookaheadItem {
  id: string
  name: string
  activityId: string | null
  wbsCode: string | null
  plannedStart: string | null
  plannedFinish: string | null
  companyId: string | null
  assigneeUserId: string | null
  locationId: string | null
  quantity: number | null
  unit: string | null
  status: 'planned' | 'in_progress' | 'done' | 'not_done' | string
  pctComplete: number | null
  varianceReason: string | null
  constraint: string | null
  constraintStatus: 'none' | 'open' | 'cleared' | string
  notes: string | null
}

export const VARIANCE_REASONS = ['design', 'material', 'labour', 'equipment', 'weather', 'prerequisite', 'permit', 'space', 'other'] as const

export interface Photo {
  id: string
  documentId: string | null
  locationId: string | null
  location: Named | null
  caption: string | null
  tags: string[]
  takenAt: string | null
  latitude: number | null
  longitude: number | null
  cameraMake: string | null
  cameraModel: string | null
  width: number | null
  height: number | null
  thumbnailStatus: string | null
  uploadedBy: Person | string | null
  records: { recordType: string; recordId: string; ref?: string | null; title?: string | null }[]
  createdAt?: string
}

export interface PhotosPage {
  items: Photo[]
  pagination: { limit: number; nextCursor: string | null }
  summary: { total: number; tags: string[] }
}

export interface Timesheet {
  id: string
  date: string
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | string
  crewId: string | null
  crew?: Named | null
  companyId: string | null
  notes: string | null
  entries: TimesheetEntry[]
  totals?: { regularHours?: number; overtimeHours?: number; workers?: number }
  createdAt?: string
}

export interface TimesheetEntry {
  id?: string
  workerId: string
  worker?: Named | null
  activityId: string | null
  costCodeId?: string | null
  locationId?: string | null
  timeType: 'regular' | 'overtime' | 'double' | string
  hours: number
  notes?: string | null
}

export interface Crew {
  id: string
  name: string
  companyId: string | null
  defaultActivityId: string | null
  workerIds?: string[]
  workers?: Named[]
}

export interface Worker {
  id: string
  name: string
  companyId: string | null
  trade: string | null
  status: string
}
