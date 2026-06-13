import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { User } from '../data/schema'

interface UsersResponse {
  items: User[]
  pagination: {
    limit: number
    nextCursor: string | null
  }
}

export type UsersQueryParams = {
  status?: string
  search?: string
  role?: string
  sortBy?: 'name' | 'email' | 'projects' | 'created'
  sortDir?: 'asc' | 'desc'
}

export const useUsersQuery = (params: UsersQueryParams = {}) =>
  useQuery<UsersResponse>({
    queryKey: ['users', params],
    queryFn: () =>
      apiClient
        .get('/users', {
          params,
        })
        .then((r) => r.data.data),
  })

export const useCreateUserMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: {
      name: string
      email: string
      phone?: string
      role?: string
      password: string
    }) => apiClient.post('/users', payload).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export const useInviteUserMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: {
      email: string
      role: string
      projectId?: string
      companyId?: string
      projectPartyId?: string
      note?: string
    }) =>
      apiClient.post('/users/invitations', payload).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export const useDeactivateUserMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (userId: string) =>
      apiClient.patch(`/users/${userId}/deactivate`).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export const useActivateUserMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (userId: string) =>
      apiClient.patch(`/users/${userId}/activate`).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export const useUpdateUserMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      userId,
      payload,
    }: {
      userId: string
      payload: { name?: string; email?: string; phone?: string; role?: string }
    }) => apiClient.patch(`/users/${userId}`, payload).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export const useResetPasswordMutation = () =>
  useMutation({
    mutationFn: ({
      userId,
      newPassword,
    }: {
      userId: string
      newPassword: string
    }) =>
      apiClient
        .post(`/users/${userId}/reset-password`, { newPassword })
        .then((r) => r.data.data),
  })
