import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { AddEquipmentInput, Equipment } from '../data/schema'

const equipmentKey = (projectId: string) => ['equipment', projectId]
const equipmentUsageKey = (
  projectId: string,
  filters: EquipmentUtilizationFilters = {}
) => ['equipment-utilization', projectId, filters]

export type EquipmentUtilizationFilters = {
  activityId?: string
  equipmentId?: string
  from?: string
  to?: string
}

export type EquipmentUsage = {
  id: string
  projectId: string
  activityId: string
  equipmentId: string | null
  dailyReportId: string | null
  sourceLineIndex: number | null
  equipmentName: string
  hours: number
  rateType: 'hourly' | 'daily' | null
  rate: number
  costAmount: number
  usageDate: string
  status: 'approved'
  recordedBy: string | null
  approvedBy: string | null
  approvedAt: string | null
  notes: string | null
  createdAt: string
  activity: {
    id: string
    name: string
    wbsCode: string | null
    category: string | null
  } | null
  equipment: {
    id: string
    name: string
    rateType: 'hourly' | 'daily'
    rate: number
  } | null
  dailyReport: {
    id: string
    date: string
    status: string
  } | null
}

export type EquipmentUtilizationReport = {
  totals: {
    hours: number
    costAmount: number
    unpricedHours: number
    pricedHours: number
    usageCount: number
    activityCount: number
    equipmentCount: number
  }
  byActivity: Array<{
    activityId: string
    activityName: string
    wbsCode: string | null
    category: string | null
    hours: number
    costAmount: number
    usageCount: number
    equipment: Array<{
      equipmentId: string | null
      equipmentName: string
      hours: number
      costAmount: number
      dailyReportId: string | null
      usageDate: string
    }>
  }>
  byEquipment: Array<{
    equipmentId: string | null
    equipmentName: string
    rateType: 'hourly' | 'daily' | null
    rate: number
    hours: number
    costAmount: number
    usageCount: number
    activities: Array<{
      activityId: string
      activityName: string
      wbsCode: string | null
      hours: number
      costAmount: number
      dailyReportId: string | null
      usageDate: string
    }>
  }>
  recentUsage: EquipmentUsage[]
}

const cleanFilters = (filters: EquipmentUtilizationFilters) =>
  Object.fromEntries(
    Object.entries(filters).filter(([, value]) => Boolean(value))
  )

export const useEquipment = (projectId: string) =>
  useQuery<Equipment[]>({
    queryKey: equipmentKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/equipment`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useEquipmentUtilization = (
  projectId: string,
  filters: EquipmentUtilizationFilters = {}
) =>
  useQuery<EquipmentUtilizationReport>({
    queryKey: equipmentUsageKey(projectId, filters),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/equipment/usage`, {
          params: cleanFilters(filters),
        })
        .then((response) => response.data.data as EquipmentUtilizationReport),
    enabled: Boolean(projectId),
  })

export const useAddEquipment = (projectId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: AddEquipmentInput) =>
      apiClient
        .post(`/projects/${projectId}/equipment`, payload)
        .then((response) => response.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: equipmentKey(projectId) })
      queryClient.invalidateQueries({
        queryKey: ['equipment-utilization', projectId],
      })
    },
  })
}

export const useDeleteEquipment = (projectId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (equipmentId: string) =>
      apiClient
        .delete(`/projects/${projectId}/equipment/${equipmentId}`)
        .then((response) => response.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: equipmentKey(projectId) })
      queryClient.invalidateQueries({
        queryKey: ['equipment-utilization', projectId],
      })
    },
  })
}
