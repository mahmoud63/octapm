import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export const locationKinds = [
  'site',
  'building',
  'level',
  'zone',
  'room',
  'area',
  'external',
] as const

export type LocationKind = (typeof locationKinds)[number]
export type LocationStatus = 'active' | 'archived'

export interface LocationRecord {
  id: string
  projectId: string
  parentId: string | null
  name: string
  code: string | null
  kind: LocationKind
  path: string
  pathNames: string[]
  fullName: string
  depth: number
  sortOrder: number
  status: LocationStatus
  description: string | null
  childCount: number
  createdBy: string | null
  updatedBy: string | null
  archivedAt: string | null
  archivedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface LocationNode extends LocationRecord {
  children: LocationNode[]
}

export interface LocationListResponse {
  items: LocationRecord[]
  tree: LocationNode[]
  summary: {
    total: number
    active: number
    archived: number
    roots: number
    maxDepth: number
  }
}

export interface LocationPayload {
  name: string
  code?: string | null
  kind?: LocationKind
  parentId?: string | null
  description?: string | null
  sortOrder?: number | null
}

export const locationsKey = (projectId: string, includeArchived = false) => [
  'locations',
  projectId,
  { includeArchived },
]

const invalidateLocations = (
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  queryClient.invalidateQueries({ queryKey: ['locations', projectId] })
  queryClient.invalidateQueries({ queryKey: ['audit-events', projectId] })
}

export const useLocations = (
  projectId: string,
  options: { includeArchived?: boolean; enabled?: boolean } = {}
) => {
  const includeArchived = options.includeArchived ?? false
  return useQuery<LocationListResponse>({
    queryKey: locationsKey(projectId, includeArchived),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/locations`, {
          params: includeArchived ? { includeArchived: true } : undefined,
        })
        .then((response) => response.data.data),
    enabled: Boolean(projectId) && (options.enabled ?? true),
  })
}

export const useCreateLocation = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: LocationPayload) =>
      apiClient
        .post(`/projects/${projectId}/locations`, payload)
        .then((response) => response.data.data as LocationRecord),
    onSuccess: () => invalidateLocations(queryClient, projectId),
  })
}

export const useUpdateLocation = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      locationId,
      payload,
    }: {
      locationId: string
      payload: Partial<LocationPayload>
    }) =>
      apiClient
        .patch(`/projects/${projectId}/locations/${locationId}`, payload)
        .then((response) => response.data.data as LocationRecord),
    onSuccess: () => invalidateLocations(queryClient, projectId),
  })
}

export const useReorderLocations = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: { parentId?: string | null; orderedIds: string[] }) =>
      apiClient
        .post(`/projects/${projectId}/locations/reorder`, payload)
        .then((response) => response.data.data as LocationRecord[]),
    onSuccess: () => invalidateLocations(queryClient, projectId),
  })
}

export const useArchiveLocation = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      locationId,
      reason,
    }: {
      locationId: string
      reason?: string
    }) =>
      apiClient
        .post(`/projects/${projectId}/locations/${locationId}/archive`, {
          reason,
        })
        .then((response) => response.data.data),
    onSuccess: () => invalidateLocations(queryClient, projectId),
  })
}

export const useRestoreLocation = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (locationId: string) =>
      apiClient
        .post(`/projects/${projectId}/locations/${locationId}/restore`, {})
        .then((response) => response.data.data as LocationRecord),
    onSuccess: () => invalidateLocations(queryClient, projectId),
  })
}
