import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export interface LongLeadItemRecord {
  id: string
  projectId: string
  activityId: string | null
  item: string
  leadWeeks: number
  orderBy: string | null
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
}

export interface LongLeadPayload {
  activityId?: string | null
  item: string
  leadWeeks: number
  orderBy?: string
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
