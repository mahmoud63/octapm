import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AxiosError } from 'axios'
import { apiClient } from '@/services/api/client'
import { activityDetailKey, boqItemDetailKey } from '@/features/controls/hooks/use-controls-detail'
import { projectSetupReadinessKey } from '@/features/projects/hooks/use-projects'
import type {
  ProjectBoq,
  ActivityBoqAllocation,
  AllocationSummary,
  BoqBaselineState,
  BoqRevisionSummary,
  CreateBoqItemInput,
  CreateBoqActivityInput,
  UpdateBoqActivityInput,
} from '../data/schema'

type BoqUploadResponse = {
  jobId: string
  revisionId: string
  mode: 'imported' | 'comparison_only'
  baselineLocked: boolean
  comparison?: {
    added: number
    updated: number
    unchanged: number
    removed: number
    blocked: number
  } | null
  document?: {
    documentId: string
    downloadUrl: string
    filename: string
    mimeType: string
    sizeBytes: number
    scanStatus: 'clean'
    retentionExpiresAt?: string | null
  }
}

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

type ApiErrorResponse = { error?: { message?: string } }

function apiErrorMessage(
  err: AxiosError<ApiErrorResponse>,
  fallback: string,
) {
  return err.response?.data?.error?.message ?? fallback
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
    qc.invalidateQueries({ queryKey: ['audit-events', projectId] }),
    qc.invalidateQueries({ queryKey: projectSetupReadinessKey(projectId) }),
    // The PC-5 detail drawers show allocations, mapped quantity and the figures worked from them.
    qc.invalidateQueries({ queryKey: boqItemDetailKey(projectId) }),
    qc.invalidateQueries({ queryKey: activityDetailKey(projectId) }),
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, label }: { file: File; label?: string }) => {
      const fd = new FormData()
      fd.append('file', file)
      if (label?.trim()) fd.append('label', label.trim())
      return apiClient
        .post(`/projects/${projectId}/boq/upload`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((r) => r.data.data as BoqUploadResponse)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export interface BoqJob {
  id: string
  jobId: string
  status: 'processing' | 'running' | 'done' | 'error'
  jobStatus?: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  step?: string | null
  progress?: number
  message?: string | null
  error?: string | null
  errorCode?: string | null
  attempts?: number
  maxAttempts?: number
  canRetry?: boolean
  projectId: string
  mode?: 'imported' | 'comparison_only'
  revision?: Record<string, unknown> | null
  comparison?: Record<string, unknown> | null
  baseline?: Record<string, unknown> | null
  activitiesCreated?: number
}

export const useBoqJobStatus = (projectId: string, jobId: string | null) =>
  useQuery<BoqJob>({
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

// Re-queues a failed BOQ AI job; the same job id keeps polling afterwards.
export const useRetryBoqJob = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) =>
      apiClient
        .post(`/projects/${projectId}/boq/job/${jobId}/retry`)
        .then((r) => r.data.data as BoqJob),
    onSuccess: (job) => {
      qc.setQueryData(['boq-job', projectId, job.jobId], job)
      qc.invalidateQueries({ queryKey: ['boq-job', projectId, job.jobId] })
      qc.invalidateQueries({ queryKey: ['jobs', projectId] })
    },
  })
}

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
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['boq', projectId] }),
        qc.invalidateQueries({ queryKey: ['audit-events', projectId] }),
        qc.invalidateQueries({ queryKey: projectSetupReadinessKey(projectId) }),
      ])
    },
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
    onSuccess: async () => {
      toast.success('BOQ row added with a draft allocation link')
      await invalidateAllocationConsumers(qc, projectId)
    },
    onError: (err: AxiosError<ApiErrorResponse>) => {
      toast.error(apiErrorMessage(err, 'Failed to add row'))
    },
  })
}

export function useDeleteBoqItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) =>
      apiClient
        .delete(`/projects/${projectId}/boq/items/${itemId}`)
        .then((r) => r.data.data),
    onSuccess: async () => {
      toast.success('Row deleted')
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['boq', projectId] }),
        qc.invalidateQueries({ queryKey: ['audit-events', projectId] }),
        qc.invalidateQueries({ queryKey: projectSetupReadinessKey(projectId) }),
      ])
    },
    onError: (err: AxiosError<ApiErrorResponse>) => {
      toast.error(apiErrorMessage(err, 'Cannot delete this row'))
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
    onSuccess: async () => {
      toast.success('Draft allocation link added')
      await invalidateAllocationConsumers(qc, projectId)
    },
    onError: (err: AxiosError<ApiErrorResponse>) => {
      toast.error(apiErrorMessage(err, 'Failed to add activity'))
    },
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
    onSuccess: async () => {
      await invalidateAllocationConsumers(qc, projectId)
    },
    onError: (err: AxiosError<ApiErrorResponse>) => {
      toast.error(apiErrorMessage(err, 'Failed to update activity'))
    },
  })
}

export function useDeleteBoqActivity(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      input: string | { activityId: string; allocationId?: string | null }
    ) => {
      const activityId = typeof input === 'string' ? input : input.activityId
      const allocationId =
        typeof input === 'string' ? null : input.allocationId

      return apiClient
        .delete(`/projects/${projectId}/boq/activities/${activityId}`, {
          data: allocationId ? { allocationId } : undefined,
        })
        .then((r) => r.data.data)
    },
    onSuccess: async () => {
      toast.success('Draft allocation link removed')
      await invalidateAllocationConsumers(qc, projectId)
    },
    onError: (err: AxiosError<ApiErrorResponse>) => {
      toast.error(apiErrorMessage(err, 'Failed to delete activity'))
    },
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

// The revision review (PC-2): submit → approve → lock. Each step changes the
// revision's standing, never its rows, so the bill, its history and the
// readiness gates are refreshed and nothing else.
const invalidateRevisionConsumers = async (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['boq', projectId] }),
    qc.invalidateQueries({ queryKey: ['audit-events', projectId] }),
    qc.invalidateQueries({ queryKey: projectSetupReadinessKey(projectId) }),
  ])
}

type RevisionReviewInput = { revisionId: string; comment?: string | null }

const reviewRevision = (
  projectId: string,
  step: 'submit' | 'approve',
  { revisionId, comment }: RevisionReviewInput
) =>
  apiClient
    .post(
      `/projects/${projectId}/boq/revisions/${revisionId}/${step}`,
      comment?.trim() ? { comment: comment.trim() } : {}
    )
    .then((r) => r.data.data as BoqRevisionSummary)

export function useSubmitBoqRevision(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RevisionReviewInput) =>
      reviewRevision(projectId, 'submit', input),
    onSuccess: async () => {
      toast.success('BOQ revision submitted for review')
      await invalidateRevisionConsumers(qc, projectId)
    },
    // A refusal usually means the revision moved on since the page loaded:
    // the table is re-read so its buttons match where it stands.
    onError: async (err: AxiosError<ApiErrorResponse>) => {
      toast.error(apiErrorMessage(err, 'Failed to submit revision'))
      await invalidateRevisionConsumers(qc, projectId)
    },
  })
}

export function useApproveBoqRevision(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RevisionReviewInput) =>
      reviewRevision(projectId, 'approve', input),
    onSuccess: async () => {
      toast.success('BOQ revision approved')
      await invalidateRevisionConsumers(qc, projectId)
    },
    onError: async (err: AxiosError<ApiErrorResponse>) => {
      toast.error(apiErrorMessage(err, 'Failed to approve revision'))
      await invalidateRevisionConsumers(qc, projectId)
    },
  })
}

export type BoqBaselineLockResult = {
  revision: BoqRevisionSummary
  lockedRows: number
  baseline: BoqBaselineState
}

export function useLockBoqBaseline(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ revisionId, comment }: RevisionReviewInput) =>
      apiClient
        .post(
          `/projects/${projectId}/boq/revisions/${revisionId}/lock`,
          comment?.trim() ? { comment: comment.trim() } : {}
        )
        .then((r) => r.data.data as BoqBaselineLockResult),
    onSuccess: async (result) => {
      toast.success(
        `BOQ baseline locked on revision ${result.revision.revisionNumber}`
      )
      await invalidateRevisionConsumers(qc, projectId)
    },
    onError: async (err: AxiosError<ApiErrorResponse>) => {
      toast.error(apiErrorMessage(err, 'Failed to lock the BOQ baseline'))
      await invalidateRevisionConsumers(qc, projectId)
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
