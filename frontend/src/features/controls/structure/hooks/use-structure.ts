import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Project-controls structure (PC-1): the project WBS and the organisation's
 * units of measure, served from /projects/:id/structure.
 */

export type WbsSource = 'manual' | 'import' | 'ai'
export type WbsStatus = 'active' | 'archived'

export interface WbsNodeRecord {
  id: string
  projectId: string
  parentId: string | null
  code: string
  name: string
  path: string
  pathNames: string[]
  fullName: string
  depth: number
  sortOrder: number
  source: WbsSource
  externalId: string | null
  isPackage: boolean
  ownerPartyId: string | null
  commitmentId: string | null
  status: WbsStatus
  childCount: number
  activityCount: number
  boqItemCount: number
  createdBy: string | null
  updatedBy: string | null
  archivedAt: string | null
  archivedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface WbsTreeNode extends WbsNodeRecord {
  children: WbsTreeNode[]
}

export interface WbsListResponse {
  /**
   * 'outline' for a schedule reader who may not read the BOQ (owner decision
   * D3): each node then carries its id, code, name, parent, depth, place,
   * status and its child and activity counts only.
   */
  view?: 'outline'
  items: WbsNodeRecord[]
  tree: WbsTreeNode[]
  summary: {
    total: number
    active: number
    archived: number
    packages: number
    roots: number
    maxDepth: number
    linkedActivities: number
    linkedBoqItems: number
  }
}

export interface WbsNodePayload {
  code?: string
  name?: string
  parentId?: string | null
  sortOrder?: number | null
  isPackage?: boolean
  ownerPartyId?: string | null
  commitmentId?: string | null
}

export const unitDimensions = [
  'length',
  'area',
  'volume',
  'mass',
  'time',
  'count',
  'money',
] as const
export type UnitDimension = (typeof unitDimensions)[number]

export interface UnitRecord {
  id: string
  orgId: string
  code: string
  name: string
  aliases: string[]
  dimension: UnitDimension
  isSystem: boolean
  status: 'active' | 'archived'
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface UnitListResponse {
  items: UnitRecord[]
  seeded: boolean
  defaults: Array<{
    code: string
    name: string
    dimension: UnitDimension
    aliases: string[]
  }>
  summary: { total: number; active: number; archived: number }
}

export interface UnitNormaliseResponse {
  unit: string | null
  unitCode: string | null
  warning: { code: string; message: string; unit: string } | null
}

export const wbsKey = (projectId: string, includeArchived = false) => [
  'structure-wbs',
  projectId,
  { includeArchived },
]
export const unitsKey = (projectId: string) => ['structure-units', projectId]

const invalidateWbs = (
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  queryClient.invalidateQueries({ queryKey: ['structure-wbs', projectId] })
  queryClient.invalidateQueries({ queryKey: ['audit-events', projectId] })
}

export const useWbsNodes = (
  projectId: string,
  options: { includeArchived?: boolean; enabled?: boolean } = {}
) => {
  const includeArchived = options.includeArchived ?? false
  return useQuery<WbsListResponse>({
    queryKey: wbsKey(projectId, includeArchived),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/structure/wbs`, {
          params: includeArchived ? { includeArchived: true } : undefined,
        })
        .then((response) => response.data.data),
    enabled: Boolean(projectId) && (options.enabled ?? true),
  })
}

export const useCreateWbsNode = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: WbsNodePayload) =>
      apiClient
        .post(`/projects/${projectId}/structure/wbs`, payload)
        .then((response) => response.data.data as WbsNodeRecord),
    onSuccess: () => invalidateWbs(queryClient, projectId),
  })
}

export const useUpdateWbsNode = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      nodeId,
      payload,
    }: {
      nodeId: string
      payload: WbsNodePayload
    }) =>
      apiClient
        .patch(`/projects/${projectId}/structure/wbs/${nodeId}`, payload)
        .then((response) => response.data.data as WbsNodeRecord),
    onSuccess: () => invalidateWbs(queryClient, projectId),
  })
}

export const useArchiveWbsNode = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ nodeId, reason }: { nodeId: string; reason?: string }) =>
      apiClient
        .post(`/projects/${projectId}/structure/wbs/${nodeId}/archive`, {
          reason,
        })
        .then((response) => response.data.data),
    onSuccess: () => invalidateWbs(queryClient, projectId),
  })
}

export const useRestoreWbsNode = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (nodeId: string) =>
      apiClient
        .post(`/projects/${projectId}/structure/wbs/${nodeId}/restore`, {})
        .then((response) => response.data.data as WbsNodeRecord),
    onSuccess: () => invalidateWbs(queryClient, projectId),
  })
}

export const useUnits = (
  projectId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery<UnitListResponse>({
    queryKey: unitsKey(projectId),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/structure/units`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId) && (options.enabled ?? true),
  })

export const useCreateUnit = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      code: string
      name?: string
      dimension?: UnitDimension
      aliases?: string[]
    }) =>
      apiClient
        .post(`/projects/${projectId}/structure/units`, payload)
        .then((response) => response.data.data as UnitRecord),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: unitsKey(projectId) }),
  })
}

/** What a spelling resolves to; the typed text is never changed by this. */
export const normaliseUnit = (projectId: string, unit: string) =>
  apiClient
    .get(`/projects/${projectId}/structure/units/normalise`, {
      params: { unit },
    })
    .then((response) => response.data.data as UnitNormaliseResponse)
