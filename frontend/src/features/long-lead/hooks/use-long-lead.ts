import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export interface LongLeadItemRecord {
  id: string
  projectId: string
  activityId: string | null
  item: string
  leadWeeks: number
  requiredTiming: 'activity_start' | 'activity_finish'
  needOffsetDays: number
  bufferDays: number
  orderBy: string | null
  expectedDeliveryDate: string | null
  deliveredAt: string | null
  warehouseStatus: 'not_received' | 'partial' | 'received' | 'issued'
  criticality: string | null
  risk: string | null
  status: 'not_ordered' | 'ordered' | 'delivered'
  supplier: string | null
  createdAt: string
  updatedAt: string
  activity?: {
    id: string
    name: string
    wbsCode: string | null
  } | null
  /**
   * The package this is being bought under, when there is one. While it is
   * null the planner maintains the dates and statuses by hand; once it is set
   * they are read from the package, its orders and its deliveries, and typing
   * one is refused.
   */
  procurementLinked?: boolean
  derivedFields?: string[]
  procurementPackage?: {
    id: string
    packageNumber: string
    title: string
    status: string
    requiredOnSiteDate: string | null
    latestOrderDate: string | null
    orderCount: number
    receiptCount: number
  } | null
  procurementRisk?: {
    severity: 'none' | 'low' | 'medium' | 'high' | 'critical'
    reason: string
    isAtRisk: boolean
    daysAtRisk: number
    deliverySlipDays: number
    orderBySlackDays: number | null
    needSlackDays: number | null
    needDate: string | null
    orderByDate: string | null
    expectedDeliveryDate: string | null
    flags: string[]
    impactedActivity: {
      id: string
      name: string
      wbsCode: string | null
      isCritical: boolean
      totalFloat: number | null
    } | null
  }
}

export interface LongLeadPayload {
  activityId?: string | null
  item: string
  leadWeeks: number
  requiredTiming?: 'activity_start' | 'activity_finish'
  needOffsetDays?: number
  bufferDays?: number
  orderBy?: string
  expectedDeliveryDate?: string | null
  deliveredAt?: string | null
  warehouseStatus?: 'not_received' | 'partial' | 'received' | 'issued'
  criticality?: string
  risk?: string
  status?: 'not_ordered' | 'ordered' | 'delivered'
  supplier?: string
}

const longLeadKey = (projectId: string) => ['long-lead', projectId]

export const useLongLeadItems = (projectId: string) =>
  useQuery<LongLeadItemRecord[]>({
    queryKey: longLeadKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/long-lead`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateLongLeadItem = (projectId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (payload: LongLeadPayload) =>
      apiClient
        .post(`/projects/${projectId}/long-lead`, payload)
        .then((response) => response.data.data as LongLeadItemRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: longLeadKey(projectId) })
    },
  })
}

export const useUpdateLongLeadItem = (projectId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({
      itemId,
      payload,
    }: {
      itemId: string
      payload: Partial<LongLeadPayload>
    }) =>
      apiClient
        .patch(`/projects/${projectId}/long-lead/${itemId}`, payload)
        .then((response) => response.data.data as LongLeadItemRecord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: longLeadKey(projectId) })
    },
  })
}

export const useDeleteLongLeadItem = (projectId: string) => {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (itemId: string) =>
      apiClient
        .delete(`/projects/${projectId}/long-lead/${itemId}`)
        .then((response) => response.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: longLeadKey(projectId) })
    },
  })
}
