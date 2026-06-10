import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type {
  AddMaterialInput,
  Material,
  MaterialUsageInput,
} from '../data/schema'

const materialsKey = (projectId: string, activityId: string) => [
  'materials',
  projectId,
  activityId,
]

export const useMaterials = (projectId: string, activityId: string) =>
  useQuery<Material[]>({
    queryKey: materialsKey(projectId, activityId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/activities/${activityId}/materials`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId) && Boolean(activityId),
  })

export const useAddMaterial = (projectId: string, activityId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: AddMaterialInput) =>
      apiClient
        .post(
          `/projects/${projectId}/activities/${activityId}/materials`,
          payload
        )
        .then((response) => response.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: materialsKey(projectId, activityId),
      })
    },
  })
}

export const useRecordMaterialUsage = (
  projectId: string,
  activityId: string
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      materialId,
      payload,
    }: {
      materialId: string
      payload: MaterialUsageInput
    }) =>
      apiClient
        .post(
          `/projects/${projectId}/activities/${activityId}/materials/${materialId}/usage`,
          payload
        )
        .then((response) => response.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: materialsKey(projectId, activityId),
      })
    },
  })
}

export const useDeleteMaterial = (projectId: string, activityId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (materialId: string) =>
      apiClient
        .delete(
          `/projects/${projectId}/activities/${activityId}/materials/${materialId}`
        )
        .then((response) => response.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: materialsKey(projectId, activityId),
      })
    },
  })
}
