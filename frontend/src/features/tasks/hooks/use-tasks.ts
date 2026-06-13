import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { Task } from '../data/schema'

export type TasksQuery = {
  status?: string
  priority?: string
  assignee?: 'me'
  assigneeId?: string
  overdue?: boolean
  search?: string
  sortBy?: 'created' | 'updated' | 'due' | 'priority' | 'status'
  sortDir?: 'asc' | 'desc'
}

type TasksResponse = {
  rows: Task[]
  pagination: {
    limit: number
    nextCursor: string | null
  }
  summary: {
    open: number
    overdue: number
  }
}

export type TaskMutationPayload = {
  projectId?: string
  activityId?: string | null
  assigneeId?: string | null
  title: string
  description?: string | null
  label?: string
  priority?: string
  status?: string
  dueDate?: string | null
  comment?: string | null
  attachments?: Array<{
    projectDocumentId?: string
    fileName?: string
    fileUrl?: string
    storageKey?: string
  }>
}

export const tasksKey = (query: TasksQuery = {}) => ['tasks', query]

export const useTasksQuery = (query: TasksQuery = {}) =>
  useQuery<TasksResponse>({
    queryKey: tasksKey(query),
    queryFn: () =>
      apiClient
        .get('/tasks', { params: query })
        .then((response) => response.data.data),
  })

export const useCreateTask = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: TaskMutationPayload) =>
      apiClient.post('/tasks', payload).then((response) => response.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['workspace-dashboard'] })
    },
  })
}

export const useUpdateTask = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      taskId,
      payload,
    }: {
      taskId: string
      payload: Partial<TaskMutationPayload>
    }) =>
      apiClient
        .patch(`/tasks/${taskId}`, payload)
        .then((response) => response.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['workspace-dashboard'] })
    },
  })
}

export const useCloseTask = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ taskId, comment }: { taskId: string; comment?: string }) =>
      apiClient
        .post(`/tasks/${taskId}/close`, { comment })
        .then((response) => response.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['workspace-dashboard'] })
    },
  })
}

export const useDeleteTask = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (taskId: string) =>
      apiClient.delete(`/tasks/${taskId}`).then((response) => response.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['workspace-dashboard'] })
    },
  })
}

export const useAddTaskComment = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: string }) =>
      apiClient
        .post(`/tasks/${taskId}/comments`, { body })
        .then((response) => response.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}
