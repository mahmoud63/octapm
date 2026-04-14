import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export interface ScheduleRevisionListItem {
  id: string
  label: string | null
  activityCount: number
  criticalCount: number
  totalBudget: number
  createdAt: string
}

export interface ScheduleRevisionDetail extends ScheduleRevisionListItem {
  projectId: string
  snapshotJson: {
    activities?: Array<{ name?: string }>
    [key: string]: unknown
  } | null
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
