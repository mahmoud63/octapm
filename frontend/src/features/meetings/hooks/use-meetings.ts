import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { notificationSummaryKey } from '@/features/notifications/hooks/use-notifications'
import type { MeetingPayload, MeetingRecord } from '../data/schema'

export type MeetingsQuery = {
  status?: string
  meetingType?: string
  activityId?: string
  search?: string
  sortBy?: 'created' | 'updated' | 'scheduled' | 'status' | 'type'
  sortDir?: 'asc' | 'desc'
}

type MeetingsResponse = {
  rows: MeetingRecord[]
  pagination: {
    limit: number
    nextCursor: string | null
  }
  summary: {
    total: number
    draft: number
    distributed: number
    openActionItems: number
  }
}

export type MeetingDistributionPayload = {
  message?: string | null
  includeAttendees?: boolean
  recipientUserIds?: string[]
  projectPartyIds?: string[]
  recipients?: Array<{
    name?: string | null
    email?: string | null
    companyName?: string | null
  }>
}

export const meetingsKey = (projectId: string, query: MeetingsQuery = {}) => [
  'meetings',
  projectId,
  query,
]

const invalidateMeetingViews = (
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  queryClient.invalidateQueries({ queryKey: ['meetings', projectId] })
  queryClient.invalidateQueries({ queryKey: ['tasks'] })
  queryClient.invalidateQueries({ queryKey: ['audit-events', projectId] })
  queryClient.invalidateQueries({ queryKey: notificationSummaryKey })
}

export const useMeetings = (projectId: string, query: MeetingsQuery = {}) =>
  useQuery<MeetingsResponse>({
    queryKey: meetingsKey(projectId, query),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/meetings`, { params: query })
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateMeeting = (projectId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: MeetingPayload) =>
      apiClient
        .post(`/projects/${projectId}/meetings`, payload)
        .then((response) => response.data.data as MeetingRecord),
    onSuccess: () => invalidateMeetingViews(queryClient, projectId),
  })
}

export const useUpdateMeeting = (projectId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      meetingId,
      payload,
    }: {
      meetingId: string
      payload: Partial<MeetingPayload>
    }) =>
      apiClient
        .patch(`/projects/${projectId}/meetings/${meetingId}`, payload)
        .then((response) => response.data.data as MeetingRecord),
    onSuccess: () => invalidateMeetingViews(queryClient, projectId),
  })
}

export const useDistributeMeeting = (projectId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      meetingId,
      payload,
    }: {
      meetingId: string
      payload: MeetingDistributionPayload
    }) =>
      apiClient
        .post(
          `/projects/${projectId}/meetings/${meetingId}/distribute`,
          payload
        )
        .then(
          (response) =>
            response.data.data as {
              meeting: MeetingRecord
              distributionCount: number
            }
        ),
    onSuccess: () => invalidateMeetingViews(queryClient, projectId),
  })
}

export const useAddMeetingComment = (projectId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      meetingId,
      body,
      activityId,
    }: {
      meetingId: string
      body: string
      activityId?: string | null
    }) =>
      apiClient
        .post(`/projects/${projectId}/meetings/${meetingId}/comments`, {
          body,
          activityId,
        })
        .then((response) => response.data.data),
    onSuccess: () => invalidateMeetingViews(queryClient, projectId),
  })
}

export const useArchiveMeeting = (projectId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (meetingId: string) =>
      apiClient
        .delete(`/projects/${projectId}/meetings/${meetingId}`)
        .then((response) => response.data.data),
    onSuccess: () => invalidateMeetingViews(queryClient, projectId),
  })
}
