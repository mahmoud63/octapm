import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type {
  PermissionAction,
  PermissionLevel,
  PermissionMatrix,
  PermissionModule,
} from '@/lib/permissions'

export type TemplateKind = 'internal' | 'external'
export type ClientType = 'gc' | 'owner' | 'consultant' | 'subcontractor'

export interface PermissionTemplateTool {
  module: PermissionModule
  level: PermissionLevel
}

export interface PermissionTemplateGrant {
  module: PermissionModule
  action: PermissionAction | null
  transition: string | null
  key?: string
}

export interface PermissionTemplate {
  id: string
  orgId: string
  name: string
  description: string | null
  kind: TemplateKind
  clientType: ClientType | null
  baseRole: string | null
  basePartyRole: string | null
  isDefault: boolean
  isSystem: boolean
  status: 'active' | 'archived'
  tools: PermissionTemplateTool[]
  grants: PermissionTemplateGrant[]
  usage: { projectUsers: number; parties: number }
  createdAt: string | null
  updatedAt: string | null
}

export interface PermissionTemplatePayload {
  name?: string
  description?: string | null
  kind?: TemplateKind
  clientType?: ClientType | null
  baseRole?: string | null
  basePartyRole?: string | null
  status?: 'active' | 'archived'
  tools?: PermissionTemplateTool[]
  grants?: Array<Omit<PermissionTemplateGrant, 'key'>>
}

export interface PermissionCatalog {
  levels: Array<{ id: PermissionLevel; label: string; description: string }>
  actions: PermissionAction[]
  roles: Array<{ id: string; label: string }>
  partyRoles: Array<{ id: string; label: string }>
  kinds: TemplateKind[]
  clientTypes: ClientType[]
  modules: Array<{
    id: PermissionModule
    label: string
    actions: PermissionAction[]
    transitions: string[]
  }>
}

export interface ProjectTeamMember {
  userId: string
  name: string
  email: string
  orgRole: string | null
  isCompanyAdmin: boolean
  status: string
  assignmentRole: string | null
  party: {
    id: string
    role: string
    companyId: string | null
    companyName: string | null
    template: { id: string; name: string } | null
  } | null
  template: { id: string; name: string; status?: string } | null
  overrides: Record<string, unknown>
  source: PermissionMatrix['source']
}

export interface ProjectTeamResponse {
  items: ProjectTeamMember[]
  parties: Array<{
    id: string
    role: string
    companyId: string | null
    companyName: string | null
    memberCount: number
    template: { id: string; name: string } | null
  }>
}

export const permissionKeys = {
  catalog: ['permissions', 'catalog'] as const,
  templates: (filters: Record<string, unknown> = {}) =>
    ['permission-templates', filters] as const,
  myProject: (projectId: string) => ['permissions', projectId, 'me'] as const,
  myOrg: ['permissions', 'org', 'me'] as const,
  team: (projectId: string) => ['project-team', projectId] as const,
  assignable: (projectId: string, search: string) =>
    ['project-team', projectId, 'assignable', search] as const,
}

export const usePermissionCatalog = () =>
  useQuery({
    queryKey: permissionKeys.catalog,
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: PermissionCatalog }>(
        '/permissions/catalog'
      )
      return data.data
    },
    staleTime: 5 * 60 * 1000,
  })

export const usePermissionTemplates = (
  filters: { kind?: TemplateKind; includeArchived?: boolean } = {},
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: permissionKeys.templates(filters),
    queryFn: async () => {
      const { data } = await apiClient.get<{
        data: { items: PermissionTemplate[] }
      }>('/permissions/templates', { params: filters })
      return data.data
    },
    enabled: options.enabled ?? true,
  })

export const useMyProjectPermissions = (
  projectId: string | null | undefined,
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: permissionKeys.myProject(projectId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: PermissionMatrix }>(
        '/auth/me/permissions',
        { params: { projectId } }
      )
      return data.data
    },
    enabled: Boolean(projectId) && (options.enabled ?? true),
    staleTime: 30 * 1000,
  })

const invalidateTemplates = (
  queryClient: ReturnType<typeof useQueryClient>
) => {
  queryClient.invalidateQueries({ queryKey: ['permission-templates'] })
  queryClient.invalidateQueries({ queryKey: ['permissions'] })
  queryClient.invalidateQueries({ queryKey: ['project-team'] })
}

export const useCreatePermissionTemplate = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: PermissionTemplatePayload) => {
      const { data } = await apiClient.post<{ data: PermissionTemplate }>(
        '/permissions/templates',
        payload
      )
      return data.data
    },
    onSuccess: () => invalidateTemplates(queryClient),
  })
}

export const useUpdatePermissionTemplate = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      templateId,
      payload,
    }: {
      templateId: string
      payload: PermissionTemplatePayload
    }) => {
      const { data } = await apiClient.patch<{ data: PermissionTemplate }>(
        `/permissions/templates/${templateId}`,
        payload
      )
      return data.data
    },
    onSuccess: () => invalidateTemplates(queryClient),
  })
}

export const useDuplicatePermissionTemplate = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      templateId,
      name,
    }: {
      templateId: string
      name?: string
    }) => {
      const { data } = await apiClient.post<{ data: PermissionTemplate }>(
        `/permissions/templates/${templateId}/duplicate`,
        name ? { name } : {}
      )
      return data.data
    },
    onSuccess: () => invalidateTemplates(queryClient),
  })
}

export const useArchivePermissionTemplate = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (templateId: string) => {
      const { data } = await apiClient.delete<{ data: PermissionTemplate }>(
        `/permissions/templates/${templateId}`
      )
      return data.data
    },
    onSuccess: () => invalidateTemplates(queryClient),
  })
}

export const useProjectTeam = (
  projectId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: permissionKeys.team(projectId),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: ProjectTeamResponse }>(
        `/projects/${projectId}/team`
      )
      return data.data
    },
    enabled: options.enabled ?? true,
  })

export const useSetTeamMemberTemplate = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      userId,
      templateId,
    }: {
      userId: string
      templateId: string | null
    }) => {
      if (!templateId) {
        const { data } = await apiClient.delete<{ data: { removed: boolean } }>(
          `/projects/${projectId}/team/${userId}/permissions`
        )
        return data.data
      }
      const { data } = await apiClient.put<{ data: { id: string } }>(
        `/projects/${projectId}/team/${userId}/permissions`,
        { templateId }
      )
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: permissionKeys.team(projectId),
      })
      queryClient.invalidateQueries({ queryKey: ['permissions', projectId] })
      queryClient.invalidateQueries({ queryKey: ['permission-templates'] })
    },
  })
}

export const useSetPartyTemplate = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      partyId,
      templateId,
    }: {
      partyId: string
      templateId: string | null
    }) => {
      const { data } = await apiClient.put<{ data: { id: string } }>(
        `/projects/${projectId}/team/parties/${partyId}/permissions`,
        { templateId }
      )
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: permissionKeys.team(projectId),
      })
      queryClient.invalidateQueries({ queryKey: ['permissions', projectId] })
      queryClient.invalidateQueries({
        queryKey: ['project-parties', projectId],
      })
      queryClient.invalidateQueries({ queryKey: ['permission-templates'] })
    },
  })
}

/**
 * Colleagues who could be put on this project.
 *
 * Everyone in the company comes back, with the ones already here marked,
 * because the question at this screen is usually "is Priya already on this
 * job?" and a name that is simply absent does not answer it
 * (OCTA-UX-TEAM-093).
 */
export type AssignableUser = {
  userId: string
  name: string
  email: string
  orgRole: string
  isCompanyAdmin: boolean
  onProject: boolean
}

export const useAssignableUsers = (
  projectId: string,
  search: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: permissionKeys.assignable(projectId, search),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: { items: AssignableUser[] } }>(
        `/projects/${projectId}/team/assignable`,
        { params: search ? { search } : {} }
      )
      return data.data.items
    },
    enabled: options.enabled ?? true,
  })

/** Put an existing colleague on the project. */
export const useAddProjectMember = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role?: string | null }) => {
      const { data } = await apiClient.post<{
        data: { userId: string; name: string; assignmentRole: string; alreadyOnProject: boolean }
      }>(`/projects/${projectId}/team`, { userId, ...(role ? { role } : {}) })
      return data.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: permissionKeys.team(projectId) })
      void queryClient.invalidateQueries({ queryKey: ['project-team', projectId, 'assignable'] })
    },
  })
}

/** Take somebody off this project. Their account and other projects stay. */
export const useRemoveProjectMember = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      const { data } = await apiClient.delete<{ data: { removed: boolean } }>(
        `/projects/${projectId}/team/${userId}`
      )
      return data.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: permissionKeys.team(projectId) })
      void queryClient.invalidateQueries({ queryKey: ['project-team', projectId, 'assignable'] })
    },
  })
}
