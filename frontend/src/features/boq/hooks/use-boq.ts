import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AxiosError } from 'axios'
import { apiClient } from '@/services/api/client'
import type {
  ProjectBoq,
  ActivityBoqAllocation,
  AllocationSummary,
  CreateBoqItemInput,
  CreateBoqActivityInput,
  UpdateBoqActivityInput,
} from '../data/schema'

type AllocationPayload = {
  boqItemId: string
  activityId: string
  quantity: number
  amount?: number
  weight?: number
  source?: 'manual' | 'import' | 'ai' | 'migration'
  notes?: string | null
}

type AllocationListResponse = {
  allocations: ActivityBoqAllocation[]
  summary: AllocationSummary
}

const allocationKey = (projectId: string) => [
  'activity-boq-allocations',
  projectId,
]

const invalidateAllocationConsumers = async (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  await Promise.all([
    qc.invalidateQueries({ queryKey: allocationKey(projectId) }),
    qc.invalidateQueries({ queryKey: ['boq', projectId] }),
    qc.invalidateQueries({ queryKey: ['schedule', projectId] }),
    qc.invalidateQueries({ queryKey: ['activities', projectId] }),
    qc.invalidateQueries({ queryKey: ['cost-summary', projectId] }),
  ])
}

export const useProjectBoq = (projectId: string) =>
  useQuery<ProjectBoq | null>({
    queryKey: ['boq', projectId],
    queryFn: () =>
      apiClient.get(`/projects/${projectId}/boq`).then((r) => r.data.data),
    enabled: !!projectId,
  })

export const useActivityBoqAllocations = (projectId: string) =>
  useQuery<AllocationListResponse>({
    queryKey: allocationKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/activity-boq-allocations`)
        .then((r) => r.data.data),
    enabled: !!projectId,
  })

export function useBoqUpload(projectId: string) {
  return useMutation({
    mutationFn: ({ file, label }: { file: File; label?: string }) => {
      const fd = new FormData()
      fd.append('file', file)
      if (label?.trim()) fd.append('label', label.trim())
      return apiClient
        .post(`/projects/${projectId}/boq/upload`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((r) => r.data.data as { jobId: string })
    },
  })
}

export const useBoqJobStatus = (projectId: string, jobId: string | null) =>
  useQuery({
    queryKey: ['boq-job', projectId, jobId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/boq/job/${jobId}`)
        .then((r) => r.data.data),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'done' || status === 'error') return false
      return 3000
    },
  })

export function useUpdateBoqItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      itemId,
      data,
    }: {
      itemId: string
      data: Record<string, unknown>
    }) =>
      apiClient
        .patch(`/projects/${projectId}/boq/items/${itemId}`, data)
        .then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boq', projectId] }),
    onError: () => toast.error('Failed to update row'),
  })
}

export function useCreateBoqItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateBoqItemInput) =>
      apiClient
        .post(`/projects/${projectId}/boq/items`, data)
        .then((r) => r.data.data),
    onSuccess: () => {
      toast.success('BOQ row added')
      qc.invalidateQueries({ queryKey: ['boq', projectId] })
    },
    onError: () => toast.error('Failed to add row'),
  })
}

export function useDeleteBoqItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) =>
      apiClient
        .delete(`/projects/${projectId}/boq/items/${itemId}`)
        .then((r) => r.data.data),
    onSuccess: () => {
      toast.success('Row deleted')
      qc.invalidateQueries({ queryKey: ['boq', projectId] })
    },
    onError: (err: AxiosError<{ error: { message: string } }>) => {
      toast.error(
        err.response?.data?.error?.message ?? 'Cannot delete this row',
      )
    },
  })
}

export function useCreateBoqActivity(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      boqItemId,
      data,
    }: {
      boqItemId: string
      data: CreateBoqActivityInput
    }) =>
      apiClient
        .post(`/projects/${projectId}/boq/items/${boqItemId}/activities`, data)
        .then((r) => r.data.data),
    onSuccess: () => {
      toast.success('Activity added')
      qc.invalidateQueries({ queryKey: ['boq', projectId] })
    },
    onError: () => toast.error('Failed to add activity'),
  })
}

export function useUpdateBoqActivity(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      activityId,
      data,
    }: {
      activityId: string
      data: Partial<UpdateBoqActivityInput>
    }) =>
      apiClient
        .patch(`/projects/${projectId}/boq/activities/${activityId}`, data)
        .then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boq', projectId] }),
    onError: () => toast.error('Failed to update activity'),
  })
}

export function useDeleteBoqActivity(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (activityId: string) =>
      apiClient
        .delete(`/projects/${projectId}/boq/activities/${activityId}`)
        .then((r) => r.data.data),
    onSuccess: () => {
      toast.success('Activity deleted')
      qc.invalidateQueries({ queryKey: ['boq', projectId] })
    },
    onError: () => toast.error('Failed to delete activity'),
  })
}

export function useCreateActivityBoqAllocation(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: AllocationPayload) =>
      apiClient
        .post(`/projects/${projectId}/activity-boq-allocations`, data)
        .then((r) => r.data.data as ActivityBoqAllocation),
    onSuccess: async () => {
      toast.success('Allocation created')
      await invalidateAllocationConsumers(qc, projectId)
    },
    onError: (err: AxiosError<{ error: { message: string } }>) => {
      toast.error(
        err.response?.data?.error?.message ?? 'Failed to create allocation'
      )
    },
  })
}

export function useUpdateActivityBoqAllocation(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      allocationId,
      data,
    }: {
      allocationId: string
      data: Partial<AllocationPayload>
    }) =>
      apiClient
        .patch(
          `/projects/${projectId}/activity-boq-allocations/${allocationId}`,
          data
        )
        .then((r) => r.data.data as ActivityBoqAllocation),
    onSuccess: async () => {
      toast.success('Allocation updated')
      await invalidateAllocationConsumers(qc, projectId)
    },
    onError: (err: AxiosError<{ error: { message: string } }>) => {
      toast.error(
        err.response?.data?.error?.message ?? 'Failed to update allocation'
      )
    },
  })
}

export function useSubmitActivityBoqAllocation(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (allocationId: string) =>
      apiClient
        .post(
          `/projects/${projectId}/activity-boq-allocations/${allocationId}/submit`
        )
        .then((r) => r.data.data as ActivityBoqAllocation),
    onSuccess: async () => {
      toast.success('Allocation submitted')
      await invalidateAllocationConsumers(qc, projectId)
    },
    onError: () => toast.error('Failed to submit allocation'),
  })
}

export function useApproveActivityBoqAllocation(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (allocationId: string) =>
      apiClient
        .post(
          `/projects/${projectId}/activity-boq-allocations/${allocationId}/approve`
        )
        .then((r) => r.data.data as ActivityBoqAllocation),
    onSuccess: async () => {
      toast.success('Allocation approved')
      await invalidateAllocationConsumers(qc, projectId)
    },
    onError: (err: AxiosError<{ error: { message: string } }>) => {
      toast.error(
        err.response?.data?.error?.message ?? 'Failed to approve allocation'
      )
    },
  })
}

export function useRejectActivityBoqAllocation(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      allocationId,
      reason,
    }: {
      allocationId: string
      reason: string
    }) =>
      apiClient
        .post(
          `/projects/${projectId}/activity-boq-allocations/${allocationId}/reject`,
          { reason }
        )
        .then((r) => r.data.data as ActivityBoqAllocation),
    onSuccess: async () => {
      toast.success('Allocation rejected')
      await invalidateAllocationConsumers(qc, projectId)
    },
    onError: (err: AxiosError<{ error: { message: string } }>) => {
      toast.error(
        err.response?.data?.error?.message ?? 'Failed to reject allocation'
      )
    },
  })
}

export const useExtraServicesConfig = () =>
  useQuery({
    queryKey: ['extra-services-config'],
    queryFn: () =>
      apiClient.get('/config/extra-services').then((r) => r.data.data),
    staleTime: 1000 * 60 * 60,
  })
