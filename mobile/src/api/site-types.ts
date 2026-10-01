/**
 * Shapes for the site-reporting and schedule screens (M3): the daily log,
 * activities and progress, lookaheads, photos and timesheets. Checked against
 * live responses from the local API on 2026-09-18 (map §4.6, §4.7, §4.3).
 */
import type { Named, Person } from '@/api/record-types'

/**
 * The seventh section, `quantities` (PC-6, progress measurement §4), is a
 * line of the day like the other six — a quantity installed against a BOQ
 * item allocated to an activity. The server mints a *pending* progress entry
 * from it; nothing recorded here is official until the progress approvers
 * approve it on the Progress screen, so the app never reads it as progress.
 */
export type DailyLogSection = 'manpower' | 'equipment' | 'deliveries' | 'visitors' | 'delays' | 'notes' | 'quantities'
export const DAILY_LOG_SECTIONS: readonly DailyLogSection[] = ['manpower', 'equipment', 'deliveries', 'visitors', 'delays', 'notes', 'quantities']
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
  // quantities (PC-6): `quantity` above, in the item's unit
  boqItemId?: string | null
  /** The allocated BOQ item the quantity was installed against; absent when the server withholds the bill (§12). */
  boqItem?: AllocatedItemRef | null
  allocationId?: string | null
  unitCode?: string | null
  /** The pending progress entry the server minted from this line (§4), when it says. Its status is progress' own, never this row's. */
  progressEntry?: { id?: string; status?: string | null; source?: string | null } | null
  /** The server's withholding for this reader (utils/boq-figures): the keys omitted — the quantity among them for a member who may not read the BOQ — and why. */
  boqWithheld?: { keys?: string[]; reason: string } | null
  // shared
  activityId?: string | null
  activity?: Named | null
  locationId?: string | null
  location?: Named | null
  notes?: string | null
  createdAt?: string
}

/** A BOQ item as the daily log or the allocation list names it: the description and the unit, the code only when the server sent one. */
export interface AllocatedItemRef {
  /** Withheld, with the code, from a daily-log row read by a member who may not read the BOQ. */
  id?: string
  description: string
  unit?: string | null
  unitCode?: string | null
  code?: string | null
}

/**
 * One item the site may record a quantity against: an approved allocation
 * of the activity, read from the server's own picker. Every reader of
 * progress gets the item's id, description and unit; its code, allocation
 * and allocated quantity are the server's to hand over or withhold (§12):
 * a member who may not read the BOQ picks by description and unit alone.
 */
export interface AllocatedItem extends AllocatedItemRef {
  boqItemId: string
  allocationId: string | null
  /** The approved allocation's quantity in the item's unit, when the server sent it. Never a figure to invent. */
  plannedQuantity?: number | null
}

export interface AllocatedItemsAnswer {
  items: AllocatedItem[]
  notAvailable: { reason: string } | null
}

/** A quantity progress entry (PC-6 §3): source data for the installed figure once approved; pending until then. */
export interface QuantityProgressEntry {
  id: string
  activityId: string
  boqItemId: string
  allocationId?: string | null
  locationId?: string | null
  unitCode: string | null
  quantity: number
  date?: string | null
  source: 'submission' | 'daily_log' | 'manual' | 'import' | string
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | string
  submissionId?: string | null
  dailyLogId?: string | null
  note?: string | null
  boqItem?: AllocatedItemRef | null
  createdAt?: string
  approvedAt?: string | null
}

/**
 * One of the five quantities (received, issued, installed, certified, paid)
 * or the committed one, each with its own truth and basis — never merged,
 * never summed across units. `notAvailable` is the server withholding or
 * not having the figure; the app shows "—" and the reason, never 0.
 */
export interface QuantityFigure {
  value: number | null
  truth: 'source' | 'derived' | 'projection' | string | null
  basis: string | null
  unitCode: string | null
  unitMatch?: boolean | null
  /** Set by the server on a figure it withheld from this reader (utils/boq-figures); the reason is in notAvailable. */
  withheld?: boolean
  notAvailable?: { reason: string } | null
  /**
   * The installed figure only: the official installed figure the server
   * states beside Σ approved entries when the latest approved progress
   * carries a legacy typed quantity as its floor (the basis says why the
   * entries add up to less). Never sent with a withheld figure.
   */
  officialInstalled?: { value: number | null; unitCode?: string | null; basis?: string | null; installedBasis?: string | null } | null
}

export type QuantityFigureKey = 'received' | 'issued' | 'installed' | 'certified' | 'paid' | 'committed'
export const QUANTITY_FIGURE_KEYS: readonly QuantityFigureKey[] = ['received', 'issued', 'installed', 'certified', 'paid', 'committed']

/**
 * GET /projects/:id/activities/:id/quantities as the views server answers it
 * (quantity-views.service getActivityQuantities): the activity's identity,
 * its progress section (follows progress:read) and the six figures nested
 * under `figures` — never at the top level. A member the server withholds
 * the bill from (utils/boq-figures withheldActivityQuantities) gets
 * `withheld: true` and the reason at the top, and every figure withheld
 * with that same reason. Only what the app reads is typed.
 */
export interface ActivityQuantitiesAnswer {
  kind?: string
  id?: string
  activityId?: string
  code?: string | null
  name?: string | null
  cutoffDate?: string | null
  asOf?: string | null
  /** Whether the core register (quantity-progress.service) is on the server: 'present' | 'pending'. */
  core?: string
  progress?:
    | { allowed: true; method?: string; pctComplete?: { value: number | null; truth?: string | null; basis?: string | null } | null; progressSource?: string | null; planned?: QuantityFigure | null }
    | { allowed: false; module?: string; reason?: string }
    | null
  figures?: Partial<Record<QuantityFigureKey, QuantityFigure | null>> | null
  comparisons?: unknown
  items?: unknown[]
  keys?: string[]
  withheld?: boolean
  reason?: string
}

/**
 * The same, as the app reads it: the six figures by key, the whole-answer
 * withholding as `notAvailable`, and the official figure's source.
 */
export type ActivityQuantities = Partial<Record<QuantityFigureKey, QuantityFigure | null>> & { notAvailable?: { reason: string } | null; progressSource?: string | null }

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
  /** The quantities section is absent from a server that does not keep it yet; the six others are always there. */
  sections: Record<Exclude<DailyLogSection, 'quantities'>, DailyLogEntry[]> & { quantities?: DailyLogEntry[] }
  totals: { workers: number; manHours: number; companies: number; equipmentCount: number; equipmentHours: number; idleHours: number; deliveries: number; visitors: number; hoursLost: number; notes: number; entries: number; awaitingReview: number; quantities?: number }
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
  /** PROGRESS SOURCE: where the official figure came from (manual, mobile, daily_log, daily_report, import), as the server records it on the approved row. */
  approvedProgressSource?: string | null
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
