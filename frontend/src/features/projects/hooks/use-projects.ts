import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type {
  Company,
  CreateProjectInput,
  Project,
  ProjectParty,
  ProjectSetupReadiness,
} from '../data/schema'

type ProjectsResponse = {
  items: Project[]
  pagination: {
    limit: number
    nextCursor: string | null
  }
}

type CompaniesResponse = {
  items: Company[]
  pagination: {
    limit: number
    nextCursor: string | null
  }
}

type ProjectPartiesResponse = {
  items: ProjectParty[]
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

export const useCompanies = (params: { search?: string; status?: string } = {}) =>
  useQuery<CompaniesResponse>({
    queryKey: ['companies', params],
    queryFn: () =>
      apiClient
        .get('/companies', { params })
        .then((response) => response.data.data),
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

export const projectPartiesKey = (projectId: string) => [
  'project-parties',
  projectId,
]

export const useProjectParties = (projectId: string) =>
  useQuery<ProjectPartiesResponse>({
    queryKey: projectPartiesKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/parties`)
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
      queryClient.invalidateQueries({ queryKey: ['companies'] })
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
      queryClient.invalidateQueries({
        queryKey: projectPartiesKey(variables.projectId),
      })
      queryClient.invalidateQueries({ queryKey: ['companies'] })
    },
  })
}

export const useUpsertProjectParty = (projectId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: {
      id?: string
      role: string
      companyId?: string
      companyName?: string
      contactName?: string
      contactEmail?: string
      contactPhone?: string
      accessLevel?: string
    }) => {
      const { id, ...body } = payload
      const request = id
        ? apiClient.patch(`/projects/${projectId}/parties/${id}`, body)
        : apiClient.post(`/projects/${projectId}/parties`, body)
      return request.then((response) => response.data.data as ProjectParty)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectPartiesKey(projectId) })
      queryClient.invalidateQueries({ queryKey: ['companies'] })
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })
}

export const useArchiveProject = () => {
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
