import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/** Subcontractor payment applications (OCTA-FIN-SUBPAY-021). */

export type PayAppStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'paid'
  | 'rejected'
  | 'void'

export const PAY_APP_STATUS_LABEL: Record<PayAppStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  approved: 'Approved',
  paid: 'Paid',
  rejected: 'Rejected',
  void: 'Void',
}

export const REJECTION_CODES = [
  'OVER_APPROVED_PROGRESS',
  'MISSING_COMPLIANCE',
  'INCORRECT_QUANTITIES',
  'DUPLICATE_PERIOD',
  'BACK_CHARGE_DISPUTE',
  'OTHER',
] as const
export type RejectionCode = (typeof REJECTION_CODES)[number]
export const REJECTION_LABEL: Record<RejectionCode, string> = {
  OVER_APPROVED_PROGRESS: 'Claim exceeds approved progress',
  MISSING_COMPLIANCE: 'Compliance documents missing',
  INCORRECT_QUANTITIES: 'Incorrect quantities',
  DUPLICATE_PERIOD: 'Duplicate period',
  BACK_CHARGE_DISPUTE: 'Back-charge dispute',
  OTHER: 'Other',
}

export interface PayAppLine {
  id: string
  sovLineId: string
  lineNumber: number | null
  description: string
  costCode: string | null
  activityId: string | null
  activity: { id: string; name: string; code: string | null } | null
  scheduledAmount: number
  /** What approved change orders added to this line. */
  approvedChangeAmount: number
  /** scheduled + approved changes: the ceiling this claim may not exceed. */
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
  commitmentId: string
  commitment: {
    id: string
    ref: string
    title: string
    type: string
    status: string
    currency: string
    vendor: { id: string; name: string } | null
    insuranceReady: boolean
  } | null
  number: number
  ref: string
  periodLabel: string
  periodStart: string | null
  periodEnd: string | null
  status: PayAppStatus
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
  waiverDocumentId: string | null
  waiverDocument: { id: string; fileName: string; fileUrl: string } | null
  complianceOverrideReason: string | null
  overClaimOverrideReason: string | null
  reviewNote: string | null
  rejectionCode: RejectionCode | null
  rejectedReason: string | null
  /** How many times this application has been certified and taken back. */
  certificationRevision: number
  revokedReason: string | null
  revokedAt: string | null
  /** A certificate can be taken back only while none of it has been paid. */
  revocable: boolean
  notes: string | null
  submittedAt: string | null
  reviewedAt: string | null
  approvedAt: string | null
  rejectedAt: string | null
  paidAt: string | null
  lines: PayAppLine[]
  payments: Array<{
    id: string
    amount: number
    paidAt: string | null
    method: string | null
    reference: string | null
    note: string | null
  }>
  createdBy: string | null
  createdAt: string | null
  updatedAt: string | null
  path: string | null
}

export interface PayAppListResponse {
  items: PayApp[]
  summary: {
    total: number
    byStatus: Record<PayAppStatus, number>
    submittedNet: number
    approvedNet: number
    paid: number
    outstanding: number
    retentionHeld: number
  }
}

export interface PayAppLineInput {
  sovLineId: string
  thisPeriodAmount?: number | null
  thisPeriodPct?: number | null
  materialsOnSite?: number | null
  notes?: string | null
}

export interface PayAppUpdateInput {
  periodLabel?: string
  periodStart?: string | null
  periodEnd?: string | null
  retentionRate?: number | null
  backCharges?: number | null
  backChargesNote?: string | null
  otherDeductions?: number | null
  otherDeductionsNote?: string | null
  taxRate?: number | null
  waiverRequired?: boolean
  waiverDocumentId?: string | null
  notes?: string | null
  lines?: PayAppLineInput[]
}

const key = (projectId: string) => ['pay-apps', projectId] as const
const base = (projectId: string) => `/projects/${projectId}/pay-apps`

const invalidate = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: key(projectId) })
  qc.invalidateQueries({ queryKey: ['commitments', projectId] })
  qc.invalidateQueries({ queryKey: ['cash-flow', projectId] })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
  // Certifying — and revoking a certification — moves actual cost, so anything
  // reading it is stale from this point.
  qc.invalidateQueries({ queryKey: ['cost', projectId] })
  qc.invalidateQueries({ queryKey: ['budget', projectId] })
}

export const usePayApps = (
  projectId: string,
  query: {
    commitmentId?: string | null
    status?: PayAppStatus | 'all'
    includeVoid?: boolean
  } = {}
) =>
  useQuery<PayAppListResponse>({
    queryKey: [...key(projectId), 'list', query],
    queryFn: () =>
      apiClient
        .get(base(projectId), {
          params: Object.fromEntries(
            Object.entries(query).filter(
              ([, value]) =>
                value !== undefined &&
                value !== null &&
                value !== '' &&
                value !== 'all'
            )
          ),
        })
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const usePayApp = (projectId: string, payAppId: string | null) =>
  useQuery<PayApp>({
    queryKey: [...key(projectId), 'detail', payAppId ?? ''],
    queryFn: () =>
      apiClient
        .get(`${base(projectId)}/${payAppId}`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId && payAppId),
  })

export const useCreatePayApp = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      commitmentId: string
      periodLabel: string
      periodStart?: string | null
      periodEnd?: string | null
      retentionRate?: number | null
      waiverRequired?: boolean
      notes?: string | null
    }) =>
      apiClient
        .post(base(projectId), payload)
        .then((response) => response.data.data as PayApp),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useUpdatePayApp = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      payAppId,
      payload,
    }: {
      payAppId: string
      payload: PayAppUpdateInput
    }) =>
      apiClient
        .patch(`${base(projectId)}/${payAppId}`, payload)
        .then((response) => response.data.data as PayApp),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export type PayAppAction = 'submit' | 'review' | 'approve' | 'reject' | 'reopen'

export const usePayAppAction = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      payAppId,
      action,
      body,
    }: {
      payAppId: string
      action: PayAppAction
      body?: Record<string, unknown>
    }) =>
      apiClient
        .post(`${base(projectId)}/${payAppId}/${action}`, body ?? {})
        .then((response) => response.data.data as PayApp),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useVoidPayApp = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ payAppId, reason }: { payAppId: string; reason: string }) =>
      apiClient
        .delete(`${base(projectId)}/${payAppId}`, { data: { reason } })
        .then((response) => response.data.data as PayApp),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useRecordPayAppPayment = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      payAppId,
      payload,
    }: {
      payAppId: string
      payload: {
        amount: number
        paidAt?: string | null
        method?: string | null
        reference?: string | null
        note?: string | null
      }
    }) =>
      apiClient
        .post(`${base(projectId)}/${payAppId}/payments`, payload)
        .then((response) => response.data.data as PayApp),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const downloadPayAppPdf = async (
  projectId: string,
  payAppId: string
) => {
  const response = await apiClient.get(
    `${base(projectId)}/${payAppId}/export.pdf`,
    { responseType: 'blob', timeout: 120_000 }
  )
  const disposition = String(response.headers?.['content-disposition'] ?? '')
  const match = /filename="?([^";]+)"?/.exec(disposition)
  const fileName = match?.[1] ?? 'pay-app.pdf'
  const url = URL.createObjectURL(
    new Blob([response.data], { type: 'application/pdf' })
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
