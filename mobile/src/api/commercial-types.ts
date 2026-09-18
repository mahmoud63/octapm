/**
 * Shapes for the commercial, workflow and procurement screens (M6): change
 * events and orders, commitments, subcontractor pay applications, the
 * workflow inbox, and the procurement overview, register and alerts.
 * Checked against live responses and the serialisers on 2026-09-18
 * (map §3.1, §4.5, §4.10, §4.11).
 */
import type { Named } from '@/api/record-types'

// ── Ball in court, as the commercial records carry it ──

export interface BallInCourt {
  state: 'awaiting' | 'none' | string
  label: string | null
  party: { kind: string; label: string; role?: string | null } | null
  isYou: boolean
  canAct: boolean
  action: { transition: string; roles: string[] } | null
}

// ── Change events ──

export const CHANGE_EVENT_TYPES = ['owner_change', 'design_change', 'site_condition', 'error_omission', 'allowance', 'value_engineering', 'other'] as const
export const CHANGE_EVENT_ORIGINS = ['manual', 'rfi', 'submittal', 'daily_log', 'observation', 'meeting', 'other'] as const
export const CHANGE_EVENT_STATUSES = ['open', 'pricing', 'priced', 'converted', 'closed', 'void'] as const

export interface ChangeEventLine {
  id: string
  description: string
  costCodeId: string | null
  costCode: { id: string; code: string; name: string } | null
  budgetLineId: string | null
  activityId: string | null
  activity: { id: string; name: string; code: string | null } | null
  commitmentId: string | null
  commitment: { id: string; ref: string; title: string; vendorName: string | null } | null
  quantity: number
  unit: string | null
  unitCost: number
  romAmount: number
  quotedAmount: number | null
  quotedRfqId: string | null
  amount: number
  notes: string | null
  sortOrder: number
}

export interface ChangeEventRfq {
  id: string
  number: number
  ref: string
  companyName: string
  contactName: string | null
  status: string
  dueDate: string | null
  sentAt: string | null
  viewedAt: string | null
  quotedAt: string | null
  quoteTotal: number | null
  quoteLeadTimeDays: number | null
  declinedReason: string | null
  acceptedAt: string | null
  rejectedAt: string | null
}

export interface ChangeEvent {
  id: string
  projectId: string
  number: number
  ref: string
  title: string
  description: string | null
  type: string
  origin: string
  sourceRecordType: string | null
  sourceRecordId: string | null
  sourcePath: string | null
  status: string
  activityId: string | null
  activity: { id: string; name: string; code: string | null } | null
  locationId: string | null
  location: Named | null
  romAmount: number
  scheduleImpactDays: number | null
  ownerChange: boolean
  totals: { rom: number; quoted: number | null; estimate: number }
  changeOrderId: string | null
  changeOrder: { id: string; ref: string; status: string; value: number | null; path: string } | null
  convertedAt: string | null
  closedAt: string | null
  voidReason: string | null
  notes: string | null
  lineCount?: number
  rfqCounts: { total: number; quoted: number; accepted: number; open: number }
  lines?: ChangeEventLine[]
  rfqs?: ChangeEventRfq[]
  path: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface ChangeEventList {
  items: ChangeEvent[]
  summary: { count: number; byStatus: Record<string, number>; romTotal: number; quotedTotal: number; convertedValue: number; openRfqs: number; quotesWaiting: number }
}

export interface ChangeEventCreate {
  title: string
  description?: string
  type?: string
  origin?: string
  activityId?: string
  locationId?: string
  romAmount?: number
  scheduleImpactDays?: number
  ownerChange?: boolean
  notes?: string
}

// ── Change orders (view only on mobile) ──

export interface ChangeOrder {
  id: string
  ref: string
  description: string
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'archived' | string
  value: number | null
  category: string | null
  scheduleImpact: number | null
  scheduleImpactSummary: string | null
  costImpactSummary: string | null
  activityId: string | null
  activity?: { id: string; name: string } | null
  submittedDate: string | null
  raisedBy: string | null
  approvedAt: string | null
  approvalComment?: string | null
  rejectedReason: string | null
  attachmentRefs?: unknown[]
  activityLinks?: { activityId: string; activity?: Named | null; criticalPathImpactDays?: number | null; costImpact?: number | null }[]
  ballInCourt?: BallInCourt | null
  path?: string
  createdAt: string
  updatedAt?: string
}

// ── Commitments ──

export interface CommitmentLine {
  id: string
  lineNumber: number
  description: string
  costCode: { id: string; code: string; name?: string } | null
  boqItem: { id: string; code: string; description: string } | null
  activityId: string | null
  activity?: Named | null
  quantity?: number | null
  unit?: string | null
  unitRate?: number | null
  amount: number
}

export interface Commitment {
  id: string
  projectId: string
  ballInCourt: BallInCourt
  number: number
  ref: string
  type: 'subcontract' | 'purchase_order' | string
  title: string
  description: string | null
  status: string
  currency: string
  vendor: { id: string; name: string; email?: string | null; phone?: string | null; contactName?: string | null } | null
  supplier: string | null
  retentionRate: number | null
  paymentTerms: string | null
  startDate: string | null
  endDate: string | null
  insuranceReady: boolean
  executedAt: string | null
  submittedAt: string | null
  approvedAt: string | null
  closedAt: string | null
  voidReason: string | null
  notes: string | null
  original: number
  approvedChanges: number
  pendingChanges: number
  revised: number
  retentionOnRevised: number | null
  drawnDown: number
  lines: CommitmentLine[]
  changeOrders: { id: string; ref: string; status: string; value: number | null; title?: string | null }[]
  procurementOrders?: { id: string; ref: string; status: string }[]
  path: string
  createdAt: string
  updatedAt: string
}

// ── Pay applications ──

export interface PayAppLine {
  id: string
  sovLineId: string
  lineNumber: number
  description: string
  costCode: string | null
  activityId: string | null
  activity: { id: string; name: string; code: string | null } | null
  scheduledAmount: number
  approvedChangeAmount: number
  revisedScheduledAmount: number
  previousAmount: number
  thisPeriodAmount: number
  cumulativeAmount: number
  cumulativePct: number
  materialsOnSite: number
  approvedPct: number | null
  capAmount: number | null
  overClaimAmount: number
  balanceToFinish: number
  notes: string | null
}

export interface PayApp {
  id: string
  projectId: string
  ballInCourt: BallInCourt
  commitmentId: string
  commitment: { id: string; ref: string; title: string; type: string; status: string; currency: string; vendor: Named | null; insuranceReady: boolean } | null
  number: number
  ref: string
  periodLabel: string
  periodStart: string | null
  periodEnd: string | null
  status: 'draft' | 'submitted' | 'under_review' | 'approved' | 'paid' | 'rejected' | 'void' | string
  workThisPeriod: number
  workCumulative: number
  materialsOnSite: number
  grossThisPeriod: number
  retentionRate: number
  retentionThisPeriod: number
  retentionCumulative: number
  backCharges: number
  backChargesNote: string | null
  otherDeductions: number
  otherDeductionsNote: string | null
  taxRate: number
  taxAmount: number
  netThisPeriod: number
  paidAmount: number
  outstanding: number
  overClaimAmount: number
  waiverRequired: boolean
  reviewNote: string | null
  rejectionCode: string | null
  rejectedReason: string | null
  notes: string | null
  submittedAt: string | null
  reviewedAt: string | null
  approvedAt: string | null
  rejectedAt: string | null
  paidAt: string | null
  lines: PayAppLine[]
  payments: { id: string; amount: number; paidAt: string | null; method: string | null; reference: string | null }[]
  path: string
  createdAt: string
  updatedAt: string
}

// ── Workflow inbox ──

export interface WorkflowResponseOption {
  key: string
  label: string
  next?: string
  tone?: 'positive' | 'negative' | 'neutral' | string
  requireComment?: boolean
}

export interface WorkflowStepItem {
  assignmentId: string
  instanceId: string
  projectId: string
  project: Named | null
  tool: string
  toolLabel: string
  recordId: string
  recordRef: string | null
  recordTitle: string | null
  path: string | null
  template: { id: string; name: string | null } | null
  stepKey: string
  stepName: string
  responses: WorkflowResponseOption[]
  dueAt: string | null
  overdue: boolean
  escalatedAt: string | null
  createdAt: string
}

export interface WorkflowAssignment {
  id: string
  userId: string
  user: Named | null
  status: string
  response: string | null
  responseLabel: string | null
  comment: string | null
  isOverride: boolean
  dueAt: string | null
  respondedAt: string | null
  escalatedAt: string | null
  overdue: boolean
}

export interface WorkflowStep {
  key: string
  name: string
  type: string
  description: string | null
  days: number | null
  requireAll: boolean
  responses: WorkflowResponseOption[]
  status: string
  result: string | null
  startedAt: string | null
  dueAt: string | null
  completedAt: string | null
  assignments: WorkflowAssignment[]
}

export interface WorkflowInstance {
  id: string
  projectId: string
  project: Named | null
  tool: string
  toolLabel: string
  recordId: string
  recordRef: string | null
  recordTitle: string | null
  path: string | null
  template: { id: string; name: string | null }
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | string
  outcome: string | null
  currentStepKey: string | null
  currentStep: WorkflowStep | null
  steps: WorkflowStep[]
  context: Record<string, unknown>
  applyStatus: string | null
  applyError: string | null
  escalationLevel: number
  myAssignment?: WorkflowAssignment | null
  startedAt?: string | null
  completedAt?: string | null
  createdAt?: string
}

// ── Procurement ──

export interface LeadTimeAlert {
  id: string
  projectId: string
  activityId: string | null
  packageId: string | null
  orderId: string | null
  poLineId: string | null
  activityMaterialId: string | null
  severity: 'low' | 'medium' | 'high' | string
  reason: string
  status: 'open' | 'acknowledged' | 'resolved' | string
  daysAtRisk: number | null
  needDate: string | null
  orderByDate: string | null
  expectedDeliveryDate: string | null
  acknowledgedAt: string | null
  resolvedAt: string | null
  createdAt: string
  package?: { id: string; packageNumber: string; title: string } | null
  order?: { id: string; ref: string } | null
  activity?: Named | null
}

export interface ProcurementPackage {
  id: string
  projectId: string
  supplierId: string | null
  supplier: Named | null
  activityId: string | null
  activity: { id: string; name: string; wbsCode?: string | null; startDate?: string | null; endDate?: string | null; isCritical?: boolean; totalFloat?: number | null } | null
  packageNumber: string
  title: string
  description: string | null
  status: 'planning' | 'tendering' | 'awarded' | 'in_delivery' | 'closed' | 'cancelled' | string
  buyer: string | null
  plannedAwardDate: string | null
  requiredOnSiteDate: string | null
  requiredTiming: string | null
  needOffsetDays: number | null
  leadWeeks: number | null
  bufferDays: number | null
  latestOrderDate: string | null
  notes: string | null
  leadTimeAlerts?: LeadTimeAlert[]
  procurementRisk?: { level?: string; label?: string; daysAtRisk?: number | null } | string | null
  createdAt: string
}

export interface ProcurementOverview {
  suppliers: { id: string; name: string; code: string | null; status: string; contactName: string | null; email: string | null; phone: string | null; leadTimeReliability: number | null; tradeCategories: string[] }[]
  packages: ProcurementPackage[]
  orders: { id: string; ref: string; item: string | null; supplier: string | null; status: string; warehouseStatus: string; value: number | null; currency: string | null; requiredBy: string | null; promisedDate: string | null; packageId: string | null }[]
  alerts: LeadTimeAlert[]
  summary: { suppliers: number; packages: number; purchaseOrders: number; openAlerts: number; acknowledgedAlerts: number }
}

export interface RegisterOrderLine {
  id: string
  lineNumber: number
  itemCode: string | null
  description: string
  spec: string | null
  unit: string | null
  orderedQty: number
  receivedQty: number
  rejectedQty: number
  issuedQty: number
  outstandingQty: number
  unitCost: number | null
  amount: number | null
  activityId: string | null
  activity: string | Named | null
  costCodeId: string | null
  budgetLineId: string | null
  boqItemId: string | null
  inventoryItemId: string | null
  inventoryItem: { id: string; sku: string; name: string; unit: string } | null
  requiredDate: string | null
  promisedDate: string | null
  status: string
  notes: string | null
}

export interface RegisterOrder {
  id: string
  projectId: string
  project: string | null
  ref: string
  item: string | null
  status: string
  warehouseStatus: string
  invoiceStatus: string
  lifecycleStatus: string
  lifecycleLabel: string
  ballInCourt: BallInCourt
  supplierId: string | null
  supplier: string | null
  supplierEmail: string | null
  commitmentId: string | null
  currency: string | null
  subtotal: number | null
  taxRate: number | null
  taxAmount: number | null
  value: number | null
  invoicedAmount: number | null
  uninvoiced: number | null
  deliveryLocation: string | null
  deliveryAddress: string | null
  deliveryTerms: string | null
  paymentTerms: string | null
  orderDate: string | null
  requiredBy: string | null
  promisedDate: string | null
  deliveryDate: string | null
  submittedAt: string | null
  approvedAt: string | null
  rejectedReason: string | null
  acknowledgedAt: string | null
  acknowledgedRef: string | null
  cancelledAt: string | null
  cancelReason: string | null
  closedAt: string | null
  buyer: string | null
  notes: string | null
  lines: RegisterOrderLine[]
  receipts: { id: string; receiptNumber: string; receivedAt: string | null; deliveryNote?: string | null; warehouse?: string | Named | null; lines?: unknown[] }[]
  invoices: { id: string; ref?: string | null; status?: string; amount?: number | null }[]
}

export interface LongLeadItem {
  id: string
  item: string
  activityId: string | null
  activity?: Named | null
  procurementPackageId: string | null
  leadWeeks: number | null
  requiredTiming: string | null
  orderBy: string | null
  expectedDeliveryDate: string | null
  deliveredAt: string | null
  warehouseStatus: string | null
  criticality: string | null
  risk: string | null
  status: 'not_ordered' | 'ordered' | 'delivered' | string
  supplier: string | null
  createdAt?: string
}
