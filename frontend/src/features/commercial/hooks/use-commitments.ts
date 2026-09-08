import type { BallInCourt } from '@/components/ball-in-court'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/** Commitments: subcontracts and purchase-order commitments (OCTA-FIN-COMMIT-020). */

export type CommitmentType = 'subcontract' | 'purchase_order'
export type CommitmentStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'executed'
  | 'closed'
  | 'void'
export type CommitmentCoStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'void'

export const COMMITMENT_STATUS_LABEL: Record<CommitmentStatus, string> = {
  draft: 'Draft',
  pending: 'Awaiting approval',
  approved: 'Approved',
  executed: 'Executed',
  closed: 'Closed',
  void: 'Void',
}

export const INSURANCE_TYPES = [
  'general_liability',
  'workers_compensation',
  'auto',
  'umbrella',
  'professional',
  'builders_risk',
  'bond',
  'other',
] as const
export type InsuranceType = (typeof INSURANCE_TYPES)[number]
export const INSURANCE_LABEL: Record<InsuranceType, string> = {
  general_liability: 'General liability',
  workers_compensation: "Workers' compensation",
  auto: 'Auto',
  umbrella: 'Umbrella',
  professional: 'Professional indemnity',
  builders_risk: "Builder's risk",
  bond: 'Bond',
  other: 'Other',
}

export interface CommitmentLine {
  id?: string
  lineNumber: number
  description: string
  costCodeId: string | null
  costCode?: { id: string; code: string; name: string } | null
  budgetLineId: string | null
  budgetLineCostType?: string | null
  boqItemId: string | null
  boqItem?: { id: string; code: string | null; description: string } | null
  activityId: string | null
  activity?: { id: string; name: string; code: string | null } | null
  unit: string | null
  qty: number
  rate: number
  amount: number
  notes?: string | null
  sortOrder?: number
}

export interface CommitmentLineInput {
  lineNumber?: number
  description: string
  costCodeId?: string | null
  budgetLineId?: string | null
  boqItemId?: string | null
  activityId?: string | null
  unit?: string | null
  qty?: number | null
  rate?: number | null
  amount?: number | null
  notes?: string | null
}

export interface CommitmentInsurance {
  type: InsuranceType
  label: string | null
  required: boolean
  documentId: string | null
  expiresAt: string | null
  note: string | null
  status?: 'ok' | 'missing' | 'expired' | 'optional'
}

export interface CommitmentChangeOrder {
  id: string
  commitmentId: string
  number: number
  ref: string
  title: string
  description: string | null
  status: CommitmentCoStatus
  value: number
  primeChangeOrderId: string | null
  primeChangeOrder: { id: string; ref: string; status: string } | null
  lines: Array<{
    description: string
    /** The schedule-of-values line this change raises the ceiling of. */
    sovLineId: string | null
    costCodeId: string | null
    budgetLineId: string | null
    activityId: string | null
    amount: number
  }>
  submittedAt: string | null
  approvedAt: string | null
  rejectedAt: string | null
  rejectedReason: string | null
  createdAt: string | null
}

export interface Commitment {
  /** Whose move it is — derived by the API, never stored. */
  ballInCourt?: BallInCourt | null
  id: string
  projectId: string
  number: number
  ref: string
  type: CommitmentType
  title: string
  description: string | null
  status: CommitmentStatus
  currency: string
  vendorCompanyId: string | null
  vendor: {
    id: string
    name: string
    email: string | null
    phone: string | null
    contactName: string | null
  } | null
  projectPartyId: string | null
  supplierId: string | null
  supplier: { id: string; name: string } | null
  retentionRate: number
  paymentTerms: string | null
  startDate: string | null
  endDate: string | null
  insurance: CommitmentInsurance[]
  insuranceReady: boolean
  executedDocument: {
    id: string
    fileName: string
    mimeType: string
    sizeBytes: number
    uploadedAt: string | null
    fileUrl: string
  } | null
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
  retentionRate2?: never
  retentionOnRevised: number
  drawnDown: number
  lines: CommitmentLine[]
  changeOrders: CommitmentChangeOrder[]
  procurementOrders: Array<{
    id: string
    ref: string
    item: string
    status: string
    value: number
  }>
  createdBy: string | null
  createdAt: string | null
  updatedAt: string | null
  path: string | null
}

export interface CommitmentInput {
  type?: CommitmentType
  title?: string
  description?: string | null
  vendorCompanyId?: string | null
  supplierId?: string | null
  retentionRate?: number | null
  paymentTerms?: string | null
  currency?: string | null
  startDate?: string | null
  endDate?: string | null
  notes?: string | null
  insurance?: CommitmentInsurance[]
  lines?: CommitmentLineInput[]
}

export interface CommitmentListQuery {
  type?: CommitmentType | 'all'
  status?: CommitmentStatus | 'all'
  vendorCompanyId?: string | null
  search?: string
  includeVoid?: boolean
}

export interface CommitmentListResponse {
  items: Commitment[]
  summary: {
    total: number
    byStatus: Record<CommitmentStatus, number>
    original: number
    approvedChanges: number
    revised: number
    committed: number
    pendingChanges: number
  }
}

const commitmentsKey = (projectId: string) =>
  ['commitments', projectId] as const
const base = (projectId: string) => `/projects/${projectId}/commitments`

const invalidate = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: commitmentsKey(projectId) })
  qc.invalidateQueries({ queryKey: ['budget', projectId] })
  qc.invalidateQueries({ queryKey: ['cost-records', projectId] })
  qc.invalidateQueries({ queryKey: ['cost-summary', projectId] })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
}

const clean = (query: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(query).filter(
      ([, value]) =>
        value !== undefined && value !== null && value !== '' && value !== 'all'
    )
  )

export const useCommitments = (
  projectId: string,
  query: CommitmentListQuery = {}
) =>
  useQuery<CommitmentListResponse>({
    queryKey: [...commitmentsKey(projectId), 'list', query],
    queryFn: () =>
      apiClient
        .get(base(projectId), {
          params: clean(query as unknown as Record<string, unknown>),
        })
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCommitment = (projectId: string, commitmentId: string | null) =>
  useQuery<Commitment>({
    queryKey: [...commitmentsKey(projectId), 'detail', commitmentId ?? ''],
    queryFn: () =>
      apiClient
        .get(`${base(projectId)}/${commitmentId}`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId && commitmentId),
  })

export const useCreateCommitment = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CommitmentInput & { title: string }) =>
      apiClient
        .post(base(projectId), payload)
        .then((response) => response.data.data as Commitment),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useUpdateCommitment = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      commitmentId,
      payload,
    }: {
      commitmentId: string
      payload: CommitmentInput
    }) =>
      apiClient
        .patch(`${base(projectId)}/${commitmentId}`, payload)
        .then((response) => response.data.data as Commitment),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useReplaceCommitmentLines = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      commitmentId,
      lines,
    }: {
      commitmentId: string
      lines: CommitmentLineInput[]
    }) =>
      apiClient
        .put(`${base(projectId)}/${commitmentId}/lines`, { lines })
        .then((response) => response.data.data as Commitment),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useSetCommitmentInsurance = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      commitmentId,
      insurance,
    }: {
      commitmentId: string
      insurance: CommitmentInsurance[]
    }) =>
      apiClient
        .put(`${base(projectId)}/${commitmentId}/insurance`, { insurance })
        .then((response) => response.data.data as Commitment),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export type CommitmentAction = 'submit' | 'approve' | 'return' | 'close'

export const useCommitmentAction = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      commitmentId,
      action,
      reason,
    }: {
      commitmentId: string
      action: CommitmentAction
      reason?: string
    }) =>
      apiClient
        .post(
          `${base(projectId)}/${commitmentId}/${action}`,
          reason ? { reason } : {}
        )
        .then((response) => response.data.data as Commitment),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useVoidCommitment = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      commitmentId,
      reason,
    }: {
      commitmentId: string
      reason: string
    }) =>
      apiClient
        .delete(`${base(projectId)}/${commitmentId}`, { data: { reason } })
        .then((response) => response.data.data as Commitment),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useExecuteCommitment = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      commitmentId,
      file,
      documentId,
      override,
      overrideReason,
    }: {
      commitmentId: string
      file?: File | null
      documentId?: string | null
      override?: boolean
      overrideReason?: string | null
    }) => {
      const form = new FormData()
      if (file) form.append('file', file)
      if (documentId) form.append('documentId', documentId)
      if (override) form.append('override', 'true')
      if (overrideReason) form.append('overrideReason', overrideReason)
      return apiClient
        .post(`${base(projectId)}/${commitmentId}/execute`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120_000,
        })
        .then((response) => response.data.data as Commitment)
    },
    onSuccess: () => invalidate(qc, projectId),
  })
}

export interface CommitmentCoInput {
  title?: string
  description?: string | null
  value?: number | null
  primeChangeOrderId?: string | null
  lines?: Array<{
    description: string
    /**
     * The schedule-of-values line this change modifies. Naming it is what
     * raises that line's billing ceiling on the next pay application; without
     * it the change adds to the contract value but cannot be claimed.
     */
    sovLineId?: string | null
    costCodeId?: string | null
    budgetLineId?: string | null
    activityId?: string | null
    amount: number
  }>
}

export const useCreateCommitmentChangeOrder = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      commitmentId,
      payload,
    }: {
      commitmentId: string
      payload: CommitmentCoInput & { title: string }
    }) =>
      apiClient
        .post(`${base(projectId)}/${commitmentId}/change-orders`, payload)
        .then((response) => response.data.data as CommitmentChangeOrder),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useCommitmentChangeOrderAction = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      changeOrderId,
      action,
      reason,
    }: {
      changeOrderId: string
      action: 'submit' | 'approve' | 'reject' | 'void'
      reason?: string
    }) =>
      apiClient
        .post(
          `${base(projectId)}/change-orders/${changeOrderId}/${action}`,
          reason ? { reason } : {}
        )
        .then((response) => response.data.data as CommitmentChangeOrder),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useSpawnCommitmentChangeOrders = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      primeChangeOrderId: string
      items: Array<{
        commitmentId: string
        value?: number | null
        title?: string | null
      }>
    }) =>
      apiClient
        .post(`${base(projectId)}/change-orders/from-prime`, payload)
        .then(
          (response) => response.data.data as { items: CommitmentChangeOrder[] }
        ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const downloadCommitmentPdf = async (
  projectId: string,
  commitmentId: string
) => {
  const response = await apiClient.get(
    `${base(projectId)}/${commitmentId}/export.pdf`,
    { responseType: 'blob', timeout: 120_000 }
  )
  const disposition = String(response.headers?.['content-disposition'] ?? '')
  const match = /filename="?([^";]+)"?/.exec(disposition)
  const fileName = match?.[1] ?? 'commitment.pdf'
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
