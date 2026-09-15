import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export interface TraceActivity {
  id: string
  name: string
  p6ActivityId?: string | null
  wbsCode: string | null
  totalFloat?: number | null
  isCritical?: boolean | null
}

export interface TraceBoqItem {
  id: string
  code: string | null
  ref: string | null
  description: string
  unit: string | null
  qty: number
  rate: number
  amount?: number
}

export interface TraceAllocation {
  id: string
  quantity: number
  amount: number
  weight: number
  status?: string
  boqItem?: TraceBoqItem
  activity?: TraceActivity
}

export interface CommercialCorrespondenceLink {
  id: string
  recordType: string
  recordId: string
  correspondenceId: string
  relationType: string
  correspondence?: {
    id: string
    ref: string
    direction: string
    type: string
    subject: string
    contractualNotice: boolean
    date: string
    status: string
  }
}

export interface CommercialAttachmentRef {
  id: string
  documentId?: string | null
  fileName: string | null
  fileUrl: string | null
  storageKey: string | null
  mimeType: string | null
  sizeBytes?: number | null
  sha256?: string | null
  scanStatus?: string | null
  description: string | null
  projectDocument?: {
    id: string
    fileName: string
    originalName: string
    mimeType: string
    sizeBytes: number
    scanStatus: string
    uploadedAt: string
  } | null
}

export interface ApprovalHistoryEvent {
  id: string | null
  action: string
  oldStatus: string | null
  newStatus: string | null
  occurredAt: string
  reason: string | null
  decision?: string | null
  fromStatus?: string | null
  toStatus?: string | null
  actorId?: string | null
  actorRole?: string | null
  comment?: string | null
  createdAt?: string | null
}

export interface ActivityTraceLink {
  id?: string
  activityId: string
  relationType?: string
  scheduleImpactDays?: number
  floatImpactDays?: number
  criticalPathImpact?: boolean
  criticalPathImpactDays?: number
  costImpact?: number
  approvedScheduleImpactDays?: number
  approvedCostImpact?: number
  baselineStart?: string | null
  baselineFinish?: string | null
  impactedStart?: string | null
  impactedFinish?: string | null
  impactBasis?: string | null
  cpmSnapshotJson?: Record<string, unknown>
  delayStart?: string | null
  delayEnd?: string | null
  delayDays?: number
  floatDays?: number
  isCritical?: boolean
  approvedEotDays?: number
  ldExposure?: number
  notes?: string | null
  activity?: TraceActivity
}

export interface AllocationTraceLink {
  id?: string
  allocationId: string | null
  boqItemId: string | null
  quantity?: number
  amount?: number
  workDoneAmount?: number
  materialsOnSiteAmount?: number
  retentionAmount?: number
  allocation?: TraceAllocation | null
  boqItem?: TraceBoqItem | null
}

export interface ChangeOrderRecord {
  id: string
  projectId: string
  activityId: string | null
  ref: string
  description: string
  category: string | null
  value: number
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'archived'
  scheduleImpact: number
  scheduleImpactSummary?: string | null
  costImpactSummary?: string | null
  submittedDate: string | null
  approvedDate: string | null
  raisedBy: string | null
  rejectedReason: string | null
  createdBy?: string | null
  updatedBy?: string | null
  approvedBy?: string | null
  approvedAt?: string | null
  approvalComment?: string | null
  rejectedBy?: string | null
  rejectedAt?: string | null
  archivedAt?: string | null
  archivedBy?: string | null
  activity?: {
    id: string
    name: string
    wbsCode: string | null
  } | null
  activityLinks?: ActivityTraceLink[]
  allocationLinks?: AllocationTraceLink[]
  correspondenceLinks?: CommercialCorrespondenceLink[]
  attachmentRefs?: CommercialAttachmentRef[]
  supportingDocumentIds?: string[]
  documentIds?: string[]
  approvalHistory?: ApprovalHistoryEvent[]
  // where the approved value lands (Phase 22B): one line, or an explicit split
  budgetLineId?: string | null
  budgetAllocationsJson?: Array<{ budgetLineId: string; amount: number }>
  budgetAllocations?: Array<{ budgetLineId: string; amount: number }>
  budgetLine?: {
    id: string
    description: string | null
    costType: string
    costCode: { id: string; code: string; name: string } | null
  } | null
}

export interface ChangeOrderSummary {
  totalApproved: number
  totalPending: number
  totalScheduleImpact: number
  approvedCount: number
}

export interface IpcCertificate {
  id: string
  projectId: string
  period: string
  issueDate: string | null
  dueDate: string | null
  totalCert: number
  totalRet: number
  netPayable: number
  status: 'draft' | 'submitted' | 'certified' | 'paid'
  invoiceStatus: 'not_issued' | 'issued' | 'void'
  paymentStatus: 'unpaid' | 'partially_paid' | 'paid'
  retentionStatus: 'held' | 'partially_released' | 'released'
  amountPaid: number
  retentionReleased: number
  balanceDue: number
  submittedBy: string | null
  submittedAt?: string | null
  certifiedBy?: string | null
  certifiedAt?: string | null
  certificationComment?: string | null
  earnedValueAtCertification?: number
  approvedLimitAtCertification?: number
  overCertificationAmount?: number
  certificationOverrideReason?: string | null
  certificationOverrideBy?: string | null
  certificationOverrideAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface IpcCertificationReview {
  currentClaimedAmount: number
  previousCertifiedAmount: number
  cumulativeCertifiedAmount: number
  earnedAmount: number
  approvedLimitAmount: number
  approvedLimitQuantity?: number
  approvedVariationAmount?: number
  approvedVariationQuantity?: number
  overEarnedAmount: number
  overApprovedLimitAmount: number
  overApprovedQuantity?: number
  latestApprovedProgressId?: string | null
  latestApprovedPctComplete?: number | null
  requiresOverride?: boolean
  requiresPmOverride?: boolean
  missingProgressEvidence?: boolean
  hasMissingProgressEvidence?: boolean
  overrideLineCount?: number
  missingProgressEvidenceCount?: number
}

export interface IpcPayment {
  id: string
  projectId: string
  ipcCertificateId: string
  invoiceId: string | null
  paymentReference: string
  paymentDate: string
  amount: number
  paymentMethod: string | null
  notes: string | null
  receivedBy: string | null
  receivedAt: string
}

export interface IpcInvoice {
  id: string
  projectId: string
  ipcCertificateId: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string | null
  grossAmount: number
  retentionHeld: number
  retentionReleased: number
  netAmount: number
  amountPaid: number
  balanceDue: number
  status: 'issued' | 'partially_paid' | 'paid' | 'void'
  issuedBy: string | null
  issuedAt: string
  payments?: IpcPayment[]
}

export interface IpcRetentionRelease {
  id: string
  projectId: string
  ipcCertificateId: string
  releaseReference: string
  releaseDate: string
  amount: number
  reason: string | null
  releasedBy: string | null
  releasedAt: string
}

export interface IpcPeriodDetail extends IpcCertificate {
  items: Array<{
    id: string
    boqItemId: string
    allocationId: string | null
    ipcPeriod: string
    qty: number
    rate: number
    previousCert: number
    currentCert: number
    cumulativeCert: number
    retentionRate: number
    retention: number
    netPayable: number
    status: 'draft' | 'submitted' | 'certified' | 'paid'
    certDate: string | null
    boqItem: {
      id: string
      code: string | null
      ref: string | null
      description: string
      unit: string | null
      qty: number
      rate: number
    }
    allocation: {
      id: string
      quantity: number
      amount: number
      weight: number
      activity: {
        id: string
        name: string
        p6ActivityId: string | null
        wbsCode: string | null
      }
    } | null
    progressLinks?: Array<{
      id: string
      approvedPctComplete: number
      approvedQuantityComplete: number | null
      certifiedQuantity: number
      certifiedAmount: number
      previousCertifiedAmount: number
      cutoffDate: string | null
      activity?: TraceActivity | null
      progress?: {
        id: string
        pctComplete: number
        quantityComplete: number | null
        quantityPlanned: number | null
        quantityUnit: string | null
        progressMethod: string
        status: string
        approvedAt: string | null
        updatedAt: string
      } | null
    }>
    certificationReview?: IpcCertificationReview
  }>
  invoices?: IpcInvoice[]
  payments?: IpcPayment[]
  retentionReleases?: IpcRetentionRelease[]
  certificationReview?: IpcCertificationReview
}

const coKey = (projectId: string) => ['change-orders', projectId]
const ipcKey = (projectId: string) => ['ipc-periods', projectId]
const ipcDetailKey = (projectId: string, period: string) => [
  'ipc-period',
  projectId,
  period,
]

export const useChangeOrders = (projectId: string) =>
  useQuery<{ orders: ChangeOrderRecord[]; summary: ChangeOrderSummary }>({
    queryKey: coKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/change-orders`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateChangeOrder = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Partial<ChangeOrderRecord>) =>
      apiClient
        .post(`/projects/${projectId}/change-orders`, payload)
        .then((response) => response.data.data as ChangeOrderRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: coKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useUpdateChangeOrder = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      changeOrderId,
      payload,
    }: {
      changeOrderId: string
      payload: Partial<ChangeOrderRecord>
    }) =>
      apiClient
        .patch(`/projects/${projectId}/change-orders/${changeOrderId}`, payload)
        .then((response) => response.data.data as ChangeOrderRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: coKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useSubmitChangeOrder = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      changeOrderId,
      comment,
    }: {
      changeOrderId: string
      comment?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/change-orders/${changeOrderId}/submit`, {
          comment,
        })
        .then((response) => response.data.data as ChangeOrderRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: coKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useApproveChangeOrder = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      changeOrderId,
      comment,
    }: {
      changeOrderId: string
      comment?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/change-orders/${changeOrderId}/approve`, {
          comment,
        })
        .then((response) => response.data.data as ChangeOrderRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: coKey(projectId) })
      qc.invalidateQueries({ queryKey: budgetRevKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useRejectChangeOrder = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      changeOrderId,
      reason,
    }: {
      changeOrderId: string
      reason: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/change-orders/${changeOrderId}/reject`, {
          reason,
        })
        .then((response) => response.data.data as ChangeOrderRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: coKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useReopenChangeOrder = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      changeOrderId,
      comment,
    }: {
      changeOrderId: string
      comment?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/change-orders/${changeOrderId}/reopen`, {
          comment,
        })
        .then((response) => response.data.data as ChangeOrderRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: coKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useArchiveChangeOrder = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (changeOrderId: string) =>
      apiClient
        .delete(`/projects/${projectId}/change-orders/${changeOrderId}`)
        .then((response) => response.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: coKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useIpcPeriods = (projectId: string) =>
  useQuery<IpcCertificate[]>({
    queryKey: ipcKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/ipc`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useIpcPeriod = (projectId: string, period: string) =>
  useQuery<IpcPeriodDetail>({
    queryKey: ipcDetailKey(projectId, period),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/ipc/${period}`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId && period),
  })

export const useCreateIpcPeriod = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload?: { period?: string }) =>
      apiClient
        .post(`/projects/${projectId}/ipc`, payload || {})
        .then((response) => response.data.data as IpcPeriodDetail),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ipcKey(projectId) })
    },
  })
}

export const useUpdateIpcItem = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      period,
      itemId,
      payload,
    }: {
      period: string
      itemId: string
      payload: {
        qty?: number
        rate?: number
        retentionRate?: number
      }
    }) =>
      apiClient
        .patch(`/projects/${projectId}/ipc/${period}/items/${itemId}`, payload)
        .then((response) => response.data.data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({
        queryKey: ipcDetailKey(projectId, variables.period),
      })
      qc.invalidateQueries({ queryKey: ipcKey(projectId) })
    },
  })
}

export const useSubmitIpcPeriod = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (period: string) =>
      apiClient
        .post(`/projects/${projectId}/ipc/${period}/submit`)
        .then((response) => response.data.data),
    onSuccess: (_, period) => {
      qc.invalidateQueries({ queryKey: ipcDetailKey(projectId, period) })
      qc.invalidateQueries({ queryKey: ipcKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useCertifyIpcPeriod = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      input:
        | string
        | {
            period: string
            comment?: string
            overrideReason?: string
          }
    ) => {
      const period = typeof input === 'string' ? input : input.period
      const payload =
        typeof input === 'string'
          ? {}
          : {
              comment: input.comment || undefined,
              overrideReason: input.overrideReason || undefined,
            }
      return apiClient
        .post(`/projects/${projectId}/ipc/${period}/certify`, payload)
        .then((response) => response.data.data)
    },
    onSuccess: (_, input) => {
      const period = typeof input === 'string' ? input : input.period
      qc.invalidateQueries({ queryKey: ipcDetailKey(projectId, period) })
      qc.invalidateQueries({ queryKey: ipcKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useIssueIpcInvoice = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      period,
      payload,
    }: {
      period: string
      payload: {
        invoiceNumber?: string
        invoiceDate?: string
        dueDate?: string
      }
    }) =>
      apiClient
        .post(`/projects/${projectId}/ipc/${period}/invoice/issue`, payload)
        .then((response) => response.data.data as IpcInvoice),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({
        queryKey: ipcDetailKey(projectId, variables.period),
      })
      qc.invalidateQueries({ queryKey: ipcKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useRecordIpcPayment = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      period,
      payload,
    }: {
      period: string
      payload: {
        amount: number
        paymentReference?: string
        paymentDate?: string
        paymentMethod?: string
        notes?: string
      }
    }) =>
      apiClient
        .post(`/projects/${projectId}/ipc/${period}/payments`, payload)
        .then((response) => response.data.data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({
        queryKey: ipcDetailKey(projectId, variables.period),
      })
      qc.invalidateQueries({ queryKey: ipcKey(projectId) })
      qc.invalidateQueries({ queryKey: cashFlowKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useReleaseIpcRetention = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      period,
      payload,
    }: {
      period: string
      payload: {
        amount: number
        releaseReference?: string
        releaseDate?: string
        reason?: string
      }
    }) =>
      apiClient
        .post(`/projects/${projectId}/ipc/${period}/retention-release`, payload)
        .then((response) => response.data.data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({
        queryKey: ipcDetailKey(projectId, variables.period),
      })
      qc.invalidateQueries({ queryKey: ipcKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

/**
 * A legacy subcontractor valuation (OCTA-FIN-SUBVAL-064). Retained read-only:
 * payment applications against a subcontract commitment replaced them, and no
 * new valuations are accepted.
 */
export interface SubValuationRecord {
  id: string
  projectId: string
  ref: string
  /** The subcontractor as typed at the time. Immutable. */
  subcontractor: string
  /** The company it has since been attributed to, where the name resolved. */
  company: { id: string; name: string } | null
  period: string
  workDone: number
  materialsOnSite: number
  grossPayable: number
  retentionRate: number
  retention: number
  backCharges: number
  netPayable: number
  status: 'draft' | 'submitted' | 'certified' | 'paid'
  submittedDate: string | null
  certDate: string | null
  payDate: string | null
  activityLinks?: ActivityTraceLink[]
  allocationLinks?: AllocationTraceLink[]
  correspondenceLinks?: CommercialCorrespondenceLink[]
  attachmentRefs?: CommercialAttachmentRef[]
  approvalHistory?: ApprovalHistoryEvent[]
}

export interface BudgetRevisionRecord {
  id: string
  projectId: string
  ref: string
  title: string
  changeType: 'addition' | 'deduction'
  amount: number
  linkedChangeOrder: string | null
  effectiveDate: string | null
  cumulativeBudget: number
  notes: string | null
}

export interface CashFlowEntry {
  id: string
  projectId: string
  period: string
  inflow: number
  outflow: number
  note: string | null
  source: 'manual' | 'system'
}

export interface EotClaim {
  id: string
  projectId: string
  ref: string
  eventName: string
  eventType: string | null
  delayDays: number
  eotDaysGranted: number
  ldRatePerDay: number
  ldLiability: number
  analysis: string | null
  claimLetter: string | null
  status: 'draft' | 'submitted' | 'approved' | 'rejected'
  submittedBy?: string | null
  submittedAt?: string | null
  approvedBy?: string | null
  approvedAt?: string | null
  rejectedBy?: string | null
  rejectedAt?: string | null
  rejectionReason?: string | null
  officialAt?: string | null
  revisedCompletionRecommendation?: string | null
  cumulativeApprovedEotDays?: number
  entitlementSummaryJson?: {
    claimedDelayDays?: number
    criticalPathImpactDays?: number
    effectiveDelayDays?: number
    requestedEotDays?: number
    recommendedEotDays?: number
    nonCompensableDelayDays?: number
    ldApplicableDays?: number
    revisedCompletionRecommendation?: string | null
  }
  activityLinks?: ActivityTraceLink[]
  weatherDelayLinks?: Array<{
    id: string
    weatherDelayId: string
    delayStart: string | null
    delayEnd: string | null
    delayDays: number
    weatherDelay?: WeatherDelayRecord
  }>
  correspondenceLinks?: CommercialCorrespondenceLink[]
  attachmentRefs?: CommercialAttachmentRef[]
  approvalHistory?: ApprovalHistoryEvent[]
}

export interface WeatherDelayRecord {
  id: string
  projectId: string
  date: string
  description: string
  delayDays: number
  contractual: boolean
  monthKey: string | null
  activityLinks?: ActivityTraceLink[]
  eotClaimLinks?: Array<{
    id: string
    eotClaimId: string
    eotClaim?: Pick<
      EotClaim,
      'id' | 'ref' | 'eventName' | 'status' | 'delayDays' | 'eotDaysGranted'
    >
  }>
  correspondenceLinks?: CommercialCorrespondenceLink[]
  attachmentRefs?: CommercialAttachmentRef[]
  approvalHistory?: ApprovalHistoryEvent[]
}

const subValKey = (projectId: string) => ['sub-valuations', projectId]
const budgetRevKey = (projectId: string) => ['budget-revisions', projectId]
const cashFlowKey = (projectId: string) => ['cash-flow', projectId]
const eotKey = (projectId: string) => ['eot-claims', projectId]
const weatherKey = (projectId: string) => ['weather-delays', projectId]

export const useSubValuations = (projectId: string) =>
  useQuery<{
    rows: SubValuationRecord[]
    summary: {
      totalGross: number
      totalRetention: number
      totalNet: number
      totalPaid: number
      totalCertified: number
      totalSubmitted: number
      totalDraft: number
    }
  }>({
    queryKey: subValKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/sub-valuations`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

/**
 * Attributes a legacy valuation to a company. The free-text `subcontractor` is
 * immutable — the API answers `SUB_VALUATION_NAME_IMMUTABLE` — so this is how a
 * historical row is connected to a real party.
 */
export const useAttributeSubValuation = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      valuationId,
      companyId,
    }: {
      valuationId: string
      companyId: string | null
    }) =>
      apiClient
        .patch(`/projects/${projectId}/sub-valuations/${valuationId}`, {
          companyId,
        })
        .then((response) => response.data.data as SubValuationRecord),
    onSuccess: () => qc.invalidateQueries({ queryKey: subValKey(projectId) }),
  })
}

export const useDeleteSubValuation = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (valuationId: string) =>
      apiClient
        .delete(`/projects/${projectId}/sub-valuations/${valuationId}`)
        .then((response) => response.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: subValKey(projectId) })
      qc.invalidateQueries({ queryKey: cashFlowKey(projectId) })
    },
  })
}

export const useBudgetRevisions = (projectId: string) =>
  useQuery<{
    rows: BudgetRevisionRecord[]
    summary: {
      originalBudget: number
      netChange: number
      currentBudget: number
    }
    waterfall: Array<{
      ref: string
      title: string
      delta: number
      cumulative: number
    }>
  }>({
    queryKey: budgetRevKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/budget-revisions`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateBudgetRevision = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Partial<BudgetRevisionRecord>) =>
      apiClient
        .post(`/projects/${projectId}/budget-revisions`, payload)
        .then((response) => response.data.data as BudgetRevisionRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: budgetRevKey(projectId) })
    },
  })
}

export const useCashFlow = (projectId: string) =>
  useQuery<{
    rows: CashFlowEntry[]
    monthly: Array<{
      period: string
      inflow: number
      outflow: number
      net: number
    }>
    summary: {
      inflow: number
      outflow: number
      net: number
    }
  }>({
    queryKey: cashFlowKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/cash-flow`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateCashFlowEntry = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      period: string
      inflow?: number
      outflow?: number
    }) =>
      apiClient
        .post(`/projects/${projectId}/cash-flow`, payload)
        .then((response) => response.data.data as CashFlowEntry),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cashFlowKey(projectId) })
    },
  })
}

export const useRebuildCashFlow = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiClient
        .post(`/projects/${projectId}/cash-flow/rebuild`)
        .then((response) => response.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cashFlowKey(projectId) })
    },
  })
}

export const useEotClaims = (projectId: string) =>
  useQuery<EotClaim[]>({
    queryKey: eotKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/eot`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCalculateEot = (projectId: string) =>
  useMutation({
    mutationFn: (payload: {
      eventName: string
      eventType?: string
      delayDays: number
      eotDaysGranted?: number
      ldRatePerDay?: number
      affectedActivityIds?: string[]
      activityLinks?: Array<{
        activityId: string
        delayDays?: number
        delayStart?: string | null
        delayEnd?: string | null
        baselineStart?: string | null
        baselineFinish?: string | null
        impactedStart?: string | null
        impactedFinish?: string | null
        impactBasis?: string | null
      }>
      analysis?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/eot/calculate`, payload)
        .then((response) => response.data.data),
  })

export const useCreateEotClaim = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      eventName: string
      eventType?: string
      delayDays: number
      eotDaysGranted?: number
      ldRatePerDay?: number
      affectedActivityIds?: string[]
      activityLinks?: Array<{
        activityId: string
        delayDays?: number
        delayStart?: string | null
        delayEnd?: string | null
        baselineStart?: string | null
        baselineFinish?: string | null
        impactedStart?: string | null
        impactedFinish?: string | null
        impactBasis?: string | null
      }>
      weatherDelayIds?: string[]
      weatherDelayLinks?: Array<{
        weatherDelayId: string
        delayDays?: number
        delayStart?: string | null
        delayEnd?: string | null
      }>
      analysis?: string
      attachmentRefs?: Array<{ documentId: string; description?: string }>
      supportingDocumentIds?: string[]
      documentIds?: string[]
      status?: 'draft' | 'submitted'
    }) =>
      apiClient
        .post(`/projects/${projectId}/eot`, payload)
        .then((response) => response.data.data as EotClaim),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: eotKey(projectId) })
    },
  })
}

export const useUpdateEotClaim = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      claimId,
      payload,
    }: {
      claimId: string
      payload: Omit<Partial<EotClaim>, 'status'> & {
        status?: 'draft'
        supportingDocumentIds?: string[]
        documentIds?: string[]
        attachmentRefs?: Array<{ documentId: string; description?: string }>
      }
    }) =>
      apiClient
        .patch(`/projects/${projectId}/eot/${claimId}`, payload)
        .then((response) => response.data.data as EotClaim),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: eotKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useSubmitEotClaim = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ claimId, comment }: { claimId: string; comment?: string }) =>
      apiClient
        .post(`/projects/${projectId}/eot/${claimId}/submit`, { comment })
        .then((response) => response.data.data as EotClaim),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: eotKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useApproveEotClaim = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ claimId, comment }: { claimId: string; comment?: string }) =>
      apiClient
        .post(`/projects/${projectId}/eot/${claimId}/approve`, { comment })
        .then((response) => response.data.data as EotClaim),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: eotKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useRejectEotClaim = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ claimId, reason }: { claimId: string; reason: string }) =>
      apiClient
        .post(`/projects/${projectId}/eot/${claimId}/reject`, { reason })
        .then((response) => response.data.data as EotClaim),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: eotKey(projectId) })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useWeatherDelays = (projectId: string) =>
  useQuery<{
    rows: WeatherDelayRecord[]
    summary: {
      allowance: number
      contractualUsed: number
      remaining: number
      consumedPct: number
      warning: boolean
    }
    monthly: Array<{
      month: string
      contractual: number
      nonContractual: number
    }>
  }>({
    queryKey: weatherKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/weather-delays`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateWeatherDelay = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      description: string
      date?: string
      delayDays: number
      contractual?: boolean
      affectedActivityIds?: string[]
      activityLinks?: Array<{
        activityId: string
        delayDays?: number
        delayStart?: string | null
        delayEnd?: string | null
      }>
    }) =>
      apiClient
        .post(`/projects/${projectId}/weather-delays`, payload)
        .then((response) => response.data.data as WeatherDelayRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: weatherKey(projectId) })
    },
  })
}
