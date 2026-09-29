import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * The client contract and what it bills (OCTA-COM-PRIME-051).
 *
 * Money coming in. The BOQ is the schedule of values; this is the commercial
 * envelope around it — original value, what approved change orders did to it,
 * and the terms that turn certified work into a sum the client owes.
 */

export const CONTRACT_TYPES = ['lump_sum', 'remeasured', 'cost_plus', 'gmp'] as const
export type ContractType = (typeof CONTRACT_TYPES)[number]

export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = {
  lump_sum: 'Lump sum',
  remeasured: 'Remeasured',
  cost_plus: 'Cost plus',
  gmp: 'Guaranteed maximum price',
}

export type PrimeContract = {
  id: string
  projectId: string
  ref: string
  title: string
  clientCompanyId: string | null
  client: string | null
  contractType: ContractType
  currency: string
  originalValue: number
  approvedChangesValue: number
  pendingChangesValue: number
  revisedValue: number
  retentionRate: number
  retentionCapRate: number | null
  advanceRate: number
  advanceAmount: number
  advancePaidAmount: number
  advanceRecoveryRate: number
  advanceRecoveredAmount: number
  advanceOutstanding: number
  materialsOnSiteRate: number
  taxRate: number
  paymentTermsDays: number
  startDate: string | null
  completionDate: string | null
  status: 'draft' | 'active' | 'closed'
  notes: string | null
}

export type StatementLine = {
  boqItemId: string
  code: string | null
  section: string | null
  description: string
  unit: string | null
  quantity: number
  rate: number
  contractAmount: number
  previous: number
  thisPeriod: number
  total: number
  remaining: number
  pctComplete: number
}

export type StatementSummary = {
  originalValue: number
  approvedChangesValue: number
  pendingChangesValue: number
  revisedValue: number
  previousCertified: number
  currentCertified: number
  materialsOnSite: number
  grossThisPeriod: number
  retentionThisPeriod: number
  retentionCumulative: number
  advanceAmount: number
  advancePaid: number
  advanceRecoveredToDate: number
  advanceRecoveryThisPeriod: number
  advanceOutstanding: number
  deductions: number
  taxRate: number
  taxAmount: number
  totalDue: number
  cumulativeCertified: number
  remainingToCertify: number
  invoiced: number
  received: number
  outstanding: number
}

export type ClientStatement = {
  contract: PrimeContract
  summary: StatementSummary
  current: {
    id: string
    period: string
    status: string
    invoiceStatus: string
    paymentStatus: string
    issueDate: string | null
    dueDate: string | null
    totalCert: number
    totalRet: number
    netPayable: number
    amountPaid: number
    balanceDue: number
    deductionsNote: string | null
  } | null
  periods: Array<{
    id: string
    period: string
    status: string
    totalCert: number
    totalRet: number
    netPayable: number
    amountPaid: number
    balanceDue: number
  }>
  /**
   * The schedule of values: the BOQ's rows. Omitted by the server for a
   * member who may not read the BOQ, with `linesWithheld` saying why.
   */
  lines?: StatementLine[]
  linesWithheld?: { reason: string }
}

export type AgeingBucket = {
  key: string
  label: string
  amount: number
  count: number
}

export type Receivables = {
  currency: string
  invoiced: number
  received: number
  outstanding: number
  overdue: number
  ageing: AgeingBucket[]
  invoices: Array<{
    id: string
    invoiceNumber: string
    period: string | null
    invoiceDate: string
    dueDate: string
    netAmount: number
    amountPaid: number
    balance: number
    status: string
    daysOverdue: number
    bucket: string
  }>
}

export type AdvanceLedger = {
  items: Array<{
    id: string
    reference: string
    kind: 'payment' | 'recovery'
    amount: number
    certificateId: string | null
    occurredAt: string | null
    note: string | null
  }>
  outstanding: number
}

const unwrap = <T,>(response: { data: { data: T } }) => response.data.data
const base = (projectId: string) => `/projects/${projectId}/prime-contract`

export function usePrimeContract(projectId: string) {
  return useQuery({
    queryKey: ['prime-contract', projectId],
    queryFn: () => apiClient.get(base(projectId)).then(unwrap<PrimeContract>),
    enabled: Boolean(projectId),
  })
}

export function useClientStatement(projectId: string, period?: string) {
  return useQuery({
    queryKey: ['prime-contract', projectId, 'statement', period ?? null],
    queryFn: () =>
      apiClient
        .get(`${base(projectId)}/statement`, { params: period ? { period } : {} })
        .then(unwrap<ClientStatement>),
    enabled: Boolean(projectId),
  })
}

export function useReceivables(projectId: string) {
  return useQuery({
    queryKey: ['prime-contract', projectId, 'receivables'],
    queryFn: () =>
      apiClient.get(`${base(projectId)}/receivables`).then(unwrap<Receivables>),
    enabled: Boolean(projectId),
  })
}

export function useAdvances(projectId: string) {
  return useQuery({
    queryKey: ['prime-contract', projectId, 'advances'],
    queryFn: () => apiClient.get(`${base(projectId)}/advances`).then(unwrap<AdvanceLedger>),
    enabled: Boolean(projectId),
  })
}

/** Everything downstream of the contract re-reads when it changes. */
const invalidate = (queryClient: ReturnType<typeof useQueryClient>, projectId: string) => {
  void queryClient.invalidateQueries({ queryKey: ['prime-contract', projectId] })
  void queryClient.invalidateQueries({ queryKey: ['ipc', projectId] })
}

export function useUpdatePrimeContract(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: Partial<PrimeContract>) =>
      apiClient.patch(base(projectId), payload).then(unwrap<PrimeContract>),
    onSuccess: () => invalidate(queryClient, projectId),
  })
}

export function useRecordAdvance(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: { amount: number; reference?: string; note?: string }) =>
      apiClient.post(`${base(projectId)}/advances`, payload).then(unwrap<PrimeContract>),
    onSuccess: () => invalidate(queryClient, projectId),
  })
}

export function useUpdateCertificateAdjustments(projectId: string, period: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      materialsOnSite?: number
      deductions?: number
      deductionsNote?: string | null
    }) =>
      apiClient
        .patch(
          `/projects/${projectId}/ipc/${encodeURIComponent(period)}/adjustments`,
          payload
        )
        .then(unwrap<unknown>),
    onSuccess: () => invalidate(queryClient, projectId),
  })
}
