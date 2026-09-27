import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { projectSetupReadinessKey } from '@/features/projects/hooks/use-projects'

export type ScheduleRevisionStatus =
  | 'draft'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'baselined'
  | 'superseded'

export interface ScheduleReadinessCheck {
  key: string
  label: string
  passed: boolean
  severity: string
  message: string
  details?: Record<string, unknown>
}

export interface ScheduleReadiness {
  revisionId: string | null
  status: string
  ready: boolean
  checkedAt: string
  blockingCount: number
  checks: ScheduleReadinessCheck[]
}

export interface ScheduleRevisionListItem {
  id: string
  label: string | null
  activityCount: number
  criticalCount: number
  /** Withheld from a member who may read neither the BOQ nor the cost module. */
  totalBudget?: number
  source?: string | null
  isActive?: boolean
  status: ScheduleRevisionStatus
  submittedBy?: string | null
  submittedAt?: string | null
  reviewComment?: string | null
  approvedBy?: string | null
  approvedAt?: string | null
  approvalComment?: string | null
  rejectedBy?: string | null
  rejectedAt?: string | null
  rejectionReason?: string | null
  baselinedBy?: string | null
  baselinedAt?: string | null
  baselineComment?: string | null
  supersededBy?: string | null
  supersededAt?: string | null
  activatedBy?: string | null
  activatedAt?: string | null
  activationComment?: string | null
  previousActiveRevisionId?: string | null
  /** How many activities the revision's snapshot stores (the list only). */
  snapshotActivityCount?: number
  rolledBackBy?: string | null
  rolledBackAt?: string | null
  rollbackReason?: string | null
  mapping?: Record<string, unknown> | null
  activationAudit?: Record<string, unknown> | null
  readiness?: ScheduleReadiness | null
  statusTransitionLog?: Array<Record<string, unknown>>
  createdAt: string
}

export interface ScheduleRevisionDetail extends ScheduleRevisionListItem {
  projectId: string
  snapshotJson: {
    activities?: Array<{ name?: string }>
    [key: string]: unknown
  } | null
}

export interface ScheduleRevisionMappingActivity {
  id?: string
  key?: string
  name: string
  p6ActivityId?: string | null
  wbsCode?: string | null
  sortOrder?: number | null
}

export interface ScheduleRevisionMapping {
  revision: ScheduleRevisionListItem
  counts: {
    existing: number
    staged: number
    suggestedMappings: number
    unmappedExisting: number
    newActivities: number
  }
  suggestedMappings: Array<{
    oldActivityId: string
    newActivityKey: string
    matchType: string
    confidence: number
    oldActivity: ScheduleRevisionMappingActivity
    newActivity: ScheduleRevisionMappingActivity
  }>
  unmappedExisting: ScheduleRevisionMappingActivity[]
  newActivities: ScheduleRevisionMappingActivity[]
}

export function useScheduleRevisions(projectId: string) {
  return useQuery<ScheduleRevisionListItem[]>({
    queryKey: ['schedule-revisions', projectId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/schedule/revisions`)
        .then((r) => r.data.data),
    enabled: Boolean(projectId),
  })
}

export function useScheduleRevision(
  projectId: string,
  revisionId?: string | null
) {
  return useQuery<ScheduleRevisionDetail | null>({
    queryKey: ['schedule-revision', projectId, revisionId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/schedule/revisions/${revisionId}`)
        .then((r) => r.data.data),
    enabled: Boolean(projectId && revisionId),
  })
}

export function useScheduleRevisionMapping(
  projectId: string,
  revisionId?: string | null
) {
  return useQuery<ScheduleRevisionMapping | null>({
    queryKey: ['schedule-revision-mapping', projectId, revisionId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/schedule/revisions/${revisionId}/mapping`)
        .then((r) => r.data.data),
    enabled: Boolean(projectId && revisionId),
  })
}

export function useScheduleRevisionWorkflow(projectId: string) {
  const qc = useQueryClient()

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['schedule', projectId] }),
      qc.invalidateQueries({ queryKey: ['activities', projectId] }),
      qc.invalidateQueries({ queryKey: ['schedule-revisions', projectId] }),
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] }),
      qc.invalidateQueries({ queryKey: projectSetupReadinessKey(projectId) }),
    ])
  }

  const submitReview = useMutation({
    mutationFn: ({
      revisionId,
      comment,
    }: {
      revisionId: string
      comment?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/schedule/revisions/${revisionId}/submit-review`, {
          comment,
        })
        .then((r) => r.data.data),
    onSuccess: invalidate,
  })

  const approve = useMutation({
    mutationFn: ({
      revisionId,
      comment,
    }: {
      revisionId: string
      comment?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/schedule/revisions/${revisionId}/approve`, {
          comment,
        })
        .then((r) => r.data.data),
    onSuccess: invalidate,
  })

  const reject = useMutation({
    mutationFn: ({
      revisionId,
      reason,
    }: {
      revisionId: string
      reason: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/schedule/revisions/${revisionId}/reject`, {
          reason,
        })
        .then((r) => r.data.data),
    onSuccess: invalidate,
  })

  const baseline = useMutation({
    mutationFn: ({
      revisionId,
      comment,
    }: {
      revisionId: string
      comment?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/schedule/revisions/${revisionId}/baseline`, {
          comment,
        })
        .then((r) => r.data.data),
    onSuccess: invalidate,
  })

  const activate = useMutation({
    mutationFn: ({
      revisionId,
      mappings,
      unmappedRemovals,
      comment,
    }: {
      revisionId: string
      mappings: Array<{ oldActivityId: string; newActivityKey: string }>
      unmappedRemovals?: Array<{ oldActivityId: string; reason: string }>
      comment?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/schedule/revisions/${revisionId}/activate`, {
          mappings,
          unmappedRemovals,
          comment,
        })
        .then((r) => r.data.data),
    onSuccess: invalidate,
  })

  const rollback = useMutation({
    mutationFn: ({
      revisionId,
      reason,
    }: {
      revisionId: string
      reason: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/schedule/revisions/${revisionId}/rollback`, {
          reason,
        })
        .then((r) => r.data.data),
    onSuccess: invalidate,
  })

  return {
    submitReview,
    approve,
    reject,
    baseline,
    activate,
    rollback,
    isPending:
      submitReview.isPending ||
      approve.isPending ||
      reject.isPending ||
      baseline.isPending ||
      activate.isPending ||
      rollback.isPending,
  }
}
