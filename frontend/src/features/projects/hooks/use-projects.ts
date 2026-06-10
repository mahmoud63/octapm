import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type {
  CreateProjectInput,
  Project,
  ProjectSetupReadiness,
} from '../data/schema'

type ProjectsResponse = {
  items: Project[]
  pagination: {
    limit: number
    nextCursor: string | null
  }
}

export const projectSetupReadinessKey = (projectId: string) => [
  'project-setup-readiness',
  projectId,
]

export const useProjects = () =>
  useQuery<ProjectsResponse>({
    queryKey: ['projects'],
    queryFn: () =>
      apiClient.get('/projects').then((response) => response.data.data),
  })

export const useProject = (projectId: string) =>
  useQuery<Project>({
    queryKey: ['project', projectId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useProjectSetupReadiness = (
  projectId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery<ProjectSetupReadiness>({
    queryKey: projectSetupReadinessKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/setup-readiness`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId) && (options.enabled ?? true),
  })

export const useCreateProject = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateProjectInput) =>
      apiClient
        .post('/projects', payload)
        .then((response) => response.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export const useUpdateProject = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      projectId,
      payload,
    }: {
      projectId: string
      payload: CreateProjectInput
    }) =>
      apiClient
        .patch(`/projects/${projectId}`, payload)
        .then((response) => response.data.data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({
        queryKey: ['project', variables.projectId],
      })
    },
  })
}

export const useDeleteProject = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (projectId: string) =>
      apiClient
        .delete(`/projects/${projectId}`)
        .then((response) => response.data.data),
    onSuccess: (_, projectId) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.removeQueries({ queryKey: ['project', projectId] })
    },
  })
}
