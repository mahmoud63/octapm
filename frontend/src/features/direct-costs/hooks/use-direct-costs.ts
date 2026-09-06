import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Direct costs (OCTA-FIN-DIRECT-039): invoices, expenses and payroll not on
 * a commitment; approval posts the lines to the budget and the activities,
 * payments feed the cash flow.
 */

export type DirectCostStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'paid'
  | 'void'
export type DirectCostType = 'invoice' | 'expense' | 'payroll' | 'other'
export type DirectCostCostType =
  | 'labour'
  | 'material'
  | 'equipment'
  | 'subcontract'
  | 'indirect'
  | 'overhead'
  | 'contingency'
  | 'other'

export const DIRECT_COST_TYPE_LABEL: Record<DirectCostType, string> = {
  invoice: 'Invoice',
  expense: 'Expense',
  payroll: 'Payroll',
  other: 'Other',
}

export const DIRECT_COST_STATUS_LABEL: Record<DirectCostStatus, string> = {
  draft: 'Draft',
  pending: 'Pending approval',
  approved: 'Approved',
  paid: 'Paid',
  void: 'Void',
}

export interface DirectCostLine {
  id: string
  description: string
  costCodeId: string | null
  costCode: { id: string; code: string; name: string } | null
  budgetLineId: string | null
  budgetLine: {
    id: string
    costType: string
    description: string | null
  } | null
  activityId: string | null
  activity: { id: string; name: string; code: string | null } | null
  costType: DirectCostCostType | null
  quantity: number
  unit: string | null
  unitCost: number
  amount: number
  postedAmount: number
  notes: string | null
  sortOrder: number
}

export interface DirectCostLinePayload {
  description: string
  costCodeId?: string | null
  budgetLineId?: string | null
  activityId?: string | null
  costType?: DirectCostCostType | null
  quantity?: number
  unit?: string | null
  unitCost?: number | null
  amount?: number | null
  notes?: string | null
}

export interface DirectCostPayment {
  id: string
  amount: number
  paidAt: string
  method: string | null
  reference: string | null
  note: string | null
  createdBy: string | null
  createdAt: string | null
}

export interface DirectCost {
  id: string
  projectId: string
  number: number
  ref: string
  type: DirectCostType
  vendorCompanyId: string | null
  vendorName: string | null
  invoiceNumber: string | null
  description: string
  costDate: string
  dueDate: string | null
  receivedDate: string | null
  status: DirectCostStatus
  subtotal: number
  tax: number
  total: number
  paidTotal: number
  balance: number
  overdue: boolean
  paymentTerms: string | null
  notes: string | null
  submittedBy: string | null
  submittedAt: string | null
  approvedBy: string | null
  approvedAt: string | null
  rejectedReason: string | null
  postedAt: string | null
  voidReason: string | null
  voidedAt: string | null
  lineCount?: number | null
  paymentCount?: number | null
  lines?: DirectCostLine[]
  payments?: DirectCostPayment[]
  path: string
  createdBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface DirectCostPayload {
  type?: DirectCostType
  description?: string
  vendorCompanyId?: string | null
  vendorName?: string | null
  invoiceNumber?: string | null
  costDate?: string
  dueDate?: string | null
  receivedDate?: string | null
  tax?: number | null
  paymentTerms?: string | null
  notes?: string | null
  lines?: DirectCostLinePayload[]
}

export interface DirectCostSummary {
  count: number
  byStatus: Record<DirectCostStatus, { count: number; total: number }>
  byType: Record<DirectCostType, { count: number; total: number }>
  total: number
  paid: number
  unpaid: number
  overdue: number
  pendingApproval: number
}

const base = (projectId: string) => `/projects/${projectId}/direct-costs`
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

export const directCostKeys = {
  all: (projectId: string) => ['direct-costs', projectId] as const,
  list: (projectId: string, query: Record<string, string | undefined>) =>
    ['direct-costs', projectId, 'list', query] as const,
  one: (projectId: string, id: string) =>
    ['direct-costs', projectId, 'one', id] as const,
}

const invalidate = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: directCostKeys.all(projectId) })
  qc.invalidateQueries({ queryKey: ['budget', projectId] })
  qc.invalidateQueries({ queryKey: ['cost-summary', projectId] })
  qc.invalidateQueries({ queryKey: ['cash-flow', projectId] })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
}

export const useDirectCosts = (
  projectId: string,
  query: {
    status?: string
    type?: string
    q?: string
    from?: string
    to?: string
  } = {}
) =>
  useQuery<{ items: DirectCost[]; summary: DirectCostSummary }>({
    queryKey: directCostKeys.list(projectId, query),
    queryFn: () =>
      data(
        apiClient.get(base(projectId), {
          params: Object.fromEntries(
            Object.entries(query).filter(([, value]) => value && value.trim())
          ),
        })
      ),
    enabled: Boolean(projectId),
    placeholderData: (previous) => previous,
  })

export const useDirectCost = (projectId: string, id: string | null) =>
  useQuery<DirectCost>({
    queryKey: directCostKeys.one(projectId, id ?? ''),
    queryFn: () => data(apiClient.get(`${base(projectId)}/${id}`)),
    enabled: Boolean(projectId && id),
  })

export const useCreateDirectCost = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: DirectCostPayload) =>
      data<DirectCost>(apiClient.post(base(projectId), payload)),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useUpdateDirectCost = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...payload }: DirectCostPayload & { id: string }) =>
      data<DirectCost>(apiClient.patch(`${base(projectId)}/${id}`, payload)),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useDeleteDirectCost = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      data<{ deleted: boolean }>(apiClient.delete(`${base(projectId)}/${id}`)),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useDirectCostAction = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      action,
      body,
    }: {
      id: string
      action: 'submit' | 'approve' | 'reject' | 'void'
      body?: Record<string, unknown>
    }) =>
      data<DirectCost>(
        apiClient.post(`${base(projectId)}/${id}/${action}`, body ?? {})
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useRecordDirectCostPayment = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string
      amount: number
      paidAt?: string | null
      method?: string | null
      reference?: string | null
      note?: string | null
    }) =>
      data<DirectCost>(
        apiClient.post(`${base(projectId)}/${id}/payments`, payload)
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}
