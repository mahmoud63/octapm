import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { AddEquipmentInput, Equipment } from '../data/schema'

const equipmentKey = (projectId: string) => ['equipment', projectId]

export const useEquipment = (projectId: string) =>
  useQuery<Equipment[]>({
    queryKey: equipmentKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/equipment`)
        .then((response) => response.data.data),
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
    },
  })
}
