import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { Activity, CreateActivityInput } from '../data/schema'

const activitiesKey = (projectId: string) => ['activities', projectId]

export const useActivities = (projectId: string) =>
  useQuery<Activity[]>({
    queryKey: activitiesKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/activities`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useCreateActivity = (projectId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateActivityInput) =>
      apiClient
        .post(`/projects/${projectId}/activities`, payload)
        .then((response) => response.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activitiesKey(projectId) })
    },
  })
}

export const useUpdateActivity = (projectId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      activityId,
      payload,
    }: {
      activityId: string
      payload: CreateActivityInput
    }) =>
      apiClient
        .patch(`/projects/${projectId}/activities/${activityId}`, payload)
        .then((response) => response.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activitiesKey(projectId) })
    },
  })
}

export const useDeleteActivity = (projectId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (activityId: string) =>
      apiClient
        .delete(`/projects/${projectId}/activities/${activityId}`)
        .then((response) => response.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activitiesKey(projectId) })
    },
  })
}
