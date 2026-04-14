import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export interface ChangeOrderRecord {
  id: string
  projectId: string
  activityId: string | null
  ref: string
  description: string
  category: string | null
  value: number
  status: 'pending' | 'approved' | 'rejected'
  scheduleImpact: number
  submittedDate: string | null
  approvedDate: string | null
  raisedBy: string | null
  rejectedReason: string | null
  activity?: {
    id: string
    name: string
    wbsCode: string | null
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
  submittedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface IpcPeriodDetail extends IpcCertificate {
  items: Array<{
    id: string
    boqItemId: string
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
      ref: string | null
      description: string
      unit: string | null
      qty: number
      rate: number
    }
  }>
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
    },
  })
}

export const useDeleteChangeOrder = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (changeOrderId: string) =>
      apiClient
        .delete(`/projects/${projectId}/change-orders/${changeOrderId}`)
        .then((response) => response.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: coKey(projectId) })
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
        status?: 'draft' | 'submitted' | 'certified' | 'paid'
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
    },
  })
}

export const useCertifyIpcPeriod = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (period: string) =>
      apiClient
        .post(`/projects/${projectId}/ipc/${period}/certify`)
        .then((response) => response.data.data),
    onSuccess: (_, period) => {
      qc.invalidateQueries({ queryKey: ipcDetailKey(projectId, period) })
      qc.invalidateQueries({ queryKey: ipcKey(projectId) })
    },
  })
}

export interface SubValuationRecord {
  id: string
  projectId: string
  ref: string
  subcontractor: string
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
}

export interface WeatherDelayRecord {
  id: string
  projectId: string
  date: string
  description: string
  delayDays: number
  contractual: boolean
  monthKey: string | null
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

export const useCreateSubValuation = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Partial<SubValuationRecord>) =>
      apiClient
        .post(`/projects/${projectId}/sub-valuations`, payload)
        .then((response) => response.data.data as SubValuationRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: subValKey(projectId) })
      qc.invalidateQueries({ queryKey: cashFlowKey(projectId) })
    },
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
      analysis?: string
      status?: 'draft' | 'submitted' | 'approved' | 'rejected'
    }) =>
      apiClient
        .post(`/projects/${projectId}/eot`, payload)
        .then((response) => response.data.data as EotClaim),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: eotKey(projectId) })
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
    }) =>
      apiClient
        .post(`/projects/${projectId}/weather-delays`, payload)
        .then((response) => response.data.data as WeatherDelayRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: weatherKey(projectId) })
    },
  })
}
