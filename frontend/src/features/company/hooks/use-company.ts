import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type {
  CreateProjectInput,
  Project,
} from '@/features/projects/data/schema'
import type { PrequalState } from './use-prequalification'

export interface CompanyDirectoryEntry {
  id: string
  orgId: string
  name: string
  legalName: string | null
  tradeName: string | null
  registrationNumber: string | null
  taxNumber: string | null
  type: string
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  contactName: string | null
  isVendor: boolean
  trades: string[]
  vendorProfile: {
    leadTimeReliability?: number | null
    paymentTerms?: string | null
    notes?: string | null
    [key: string]: unknown
  }
  status: 'active' | 'inactive'
  memberCount: number
  projectCount: number
  supplierCount: number
  /** Present on the vendor list, where choosing a subcontractor happens. */
  prequalification?: PrequalState | null
  createdAt: string | null
  updatedAt: string | null
}

export interface VendorPayload {
  name?: string
  legalName?: string | null
  tradeName?: string | null
  registrationNumber?: string | null
  taxNumber?: string | null
  email?: string | null
  phone?: string | null
  website?: string | null
  address?: string | null
  contactName?: string | null
  trades?: string[]
  leadTimeReliability?: number | null
  paymentTerms?: string | null
  notes?: string | null
  status?: 'active' | 'inactive'
  isVendor?: boolean
}

export interface VendorMigrationReport {
  summary: {
    suppliers: number
    linked: number
    unlinked: number
    vendors: number
    mergedVendors: number
  }
  merged: Array<{
    companyId: string
    name: string
    suppliers: Array<{
      supplierId: string
      name: string
      projectId: string
      projectName: string | null
      status: string
    }>
  }>
  unlinked: Array<{
    supplierId: string
    name: string
    projectId: string
    projectName: string | null
  }>
}

export const costCodeCategories = [
  'labour',
  'material',
  'equipment',
  'subcontract',
  'indirect',
  'overhead',
  'contingency',
  'other',
] as const
export type CostCodeCategory = (typeof costCodeCategories)[number]

export interface CostCode {
  id: string
  orgId: string
  code: string
  name: string
  description: string | null
  category: CostCodeCategory
  parentId: string | null
  sortOrder: number
  status: 'active' | 'archived'
  childCount: number
  createdAt: string | null
  updatedAt: string | null
}

export interface CostCodePayload {
  code?: string
  name?: string
  description?: string | null
  category?: CostCodeCategory
  parentId?: string | null
  sortOrder?: number
  status?: 'active' | 'archived'
}

export interface CompanyEquipment {
  id: string
  orgId: string
  name: string
  category: string | null
  rateType: 'hourly' | 'daily'
  rate: number
  notes: string | null
  status: 'active' | 'archived'
  projectCount: number
  createdAt: string | null
  updatedAt: string | null
}

export interface CompanyEquipmentPayload {
  name?: string
  category?: string | null
  rateType?: 'hourly' | 'daily'
  rate?: number
  notes?: string | null
  status?: 'active' | 'archived'
}

export interface TemplateParty {
  role: 'owner' | 'consultant' | 'contractor' | 'subcontractor'
  companyId?: string | null
  companyName?: string | null
  accessLevel?: string
  permissionTemplateId?: string | null
  contactName?: string | null
  contactEmail?: string | null
}

export interface TemplateLocation {
  name: string
  kind: string
  code?: string | null
  children: TemplateLocation[]
}

export interface TemplateAssignment {
  userId: string
  role: string
  permissionTemplateId?: string | null
}

export interface ProjectTemplate {
  id: string
  orgId: string
  name: string
  description: string | null
  settings: Record<string, unknown>
  parties: TemplateParty[]
  folders: string[]
  locations: TemplateLocation[]
  assignments: TemplateAssignment[]
  isDefault: boolean
  status: 'active' | 'archived'
  usage: { projects: number }
  summary: {
    parties: number
    folders: number
    locations: number
    assignments: number
  }
  createdAt: string | null
  updatedAt: string | null
}

export interface ProjectTemplatePayload {
  name?: string
  description?: string | null
  settings?: Record<string, unknown>
  parties?: TemplateParty[]
  folders?: string[]
  locations?: TemplateLocation[]
  assignments?: TemplateAssignment[]
  isDefault?: boolean
  status?: 'active' | 'archived'
}

export const companyKeys = {
  directory: (filters: Record<string, unknown> = {}) =>
    ['company-directory', filters] as const,
  vendors: (filters: Record<string, unknown> = {}) =>
    ['company-vendors', filters] as const,
  vendorReport: ['company-vendor-report'] as const,
  costCodes: (filters: Record<string, unknown> = {}) =>
    ['company-cost-codes', filters] as const,
  equipment: (filters: Record<string, unknown> = {}) =>
    ['company-equipment', filters] as const,
  templates: (filters: Record<string, unknown> = {}) =>
    ['project-templates', filters] as const,
}

const get = async <T>(path: string, params?: Record<string, unknown>) => {
  const { data } = await apiClient.get<{ data: T }>(path, { params })
  return data.data
}

export const useCompanyDirectory = (
  filters: { search?: string; status?: string; vendorsOnly?: boolean } = {}
) =>
  useQuery({
    queryKey: companyKeys.directory(filters),
    queryFn: () =>
      get<{
        items: CompanyDirectoryEntry[]
        summary: {
          companies: number
          vendors: number
          users: number
          activeUsers: number
        }
      }>('/company/directory', filters),
  })

export const useVendors = (
  filters: { search?: string; trade?: string; includeInactive?: boolean } = {},
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: companyKeys.vendors(filters),
    queryFn: () =>
      get<{
        items: CompanyDirectoryEntry[]
        summary: {
          total: number
          qualified: number
          trades: Array<{ trade: string; count: number }>
        }
      }>('/company/vendors', filters),
    enabled: options.enabled ?? true,
    staleTime: 60 * 1000,
  })

export const useVendorMigrationReport = (options: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: companyKeys.vendorReport,
    queryFn: () =>
      get<VendorMigrationReport>('/company/vendors/migration-report'),
    enabled: options.enabled ?? true,
  })

const invalidateCompany = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: ['company-directory'] })
  queryClient.invalidateQueries({ queryKey: ['company-vendors'] })
  queryClient.invalidateQueries({ queryKey: ['company-vendor-report'] })
  queryClient.invalidateQueries({ queryKey: ['companies'] })
}

export const useCreateVendor = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: VendorPayload) => {
      const { data } = await apiClient.post<{ data: CompanyDirectoryEntry }>(
        '/company/vendors',
        payload
      )
      return data.data
    },
    onSuccess: () => invalidateCompany(queryClient),
  })
}

export const useUpdateVendor = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      vendorId,
      payload,
    }: {
      vendorId: string
      payload: VendorPayload
    }) => {
      const { data } = await apiClient.patch<{ data: CompanyDirectoryEntry }>(
        `/company/vendors/${vendorId}`,
        payload
      )
      return data.data
    },
    onSuccess: () => invalidateCompany(queryClient),
  })
}

export const useCostCodes = (
  filters: {
    search?: string
    category?: string
    includeArchived?: boolean
  } = {}
) =>
  useQuery({
    queryKey: companyKeys.costCodes(filters),
    queryFn: () =>
      get<{ items: CostCode[]; summary: { total: number } }>(
        '/company/cost-codes',
        filters
      ),
  })

export const useCreateCostCode = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CostCodePayload) => {
      const { data } = await apiClient.post<{ data: CostCode }>(
        '/company/cost-codes',
        payload
      )
      return data.data
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['company-cost-codes'] }),
  })
}

export const useUpdateCostCode = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      costCodeId,
      payload,
    }: {
      costCodeId: string
      payload: CostCodePayload
    }) => {
      const { data } = await apiClient.patch<{ data: CostCode }>(
        `/company/cost-codes/${costCodeId}`,
        payload
      )
      return data.data
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['company-cost-codes'] }),
  })
}

export const useImportCostCodes = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (
      rows: Array<{
        code: string
        name: string
        description?: string | null
        category?: string
        parentCode?: string | null
        sortOrder?: number
      }>
    ) => {
      const { data } = await apiClient.post<{
        data: { created: number; updated: number }
      }>('/company/cost-codes/import', { rows })
      return data.data
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['company-cost-codes'] }),
  })
}

export const useCompanyEquipment = (
  filters: { search?: string; includeArchived?: boolean } = {},
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: companyKeys.equipment(filters),
    queryFn: () =>
      get<{ items: CompanyEquipment[]; summary: { total: number } }>(
        '/company/equipment',
        filters
      ),
    enabled: options.enabled ?? true,
  })

export const useCreateCompanyEquipment = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CompanyEquipmentPayload) => {
      const { data } = await apiClient.post<{ data: CompanyEquipment }>(
        '/company/equipment',
        payload
      )
      return data.data
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['company-equipment'] }),
  })
}

export const useUpdateCompanyEquipment = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      equipmentId,
      payload,
    }: {
      equipmentId: string
      payload: CompanyEquipmentPayload
    }) => {
      const { data } = await apiClient.patch<{ data: CompanyEquipment }>(
        `/company/equipment/${equipmentId}`,
        payload
      )
      return data.data
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['company-equipment'] }),
  })
}

export const useProjectTemplates = (
  filters: { includeArchived?: boolean } = {},
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: companyKeys.templates(filters),
    queryFn: () =>
      get<{ items: ProjectTemplate[] }>('/company/project-templates', filters),
    enabled: options.enabled ?? true,
  })

const invalidateTemplates = (queryClient: ReturnType<typeof useQueryClient>) =>
  queryClient.invalidateQueries({ queryKey: ['project-templates'] })

export const useCreateProjectTemplate = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: ProjectTemplatePayload) => {
      const { data } = await apiClient.post<{ data: ProjectTemplate }>(
        '/company/project-templates',
        payload
      )
      return data.data
    },
    onSuccess: () => invalidateTemplates(queryClient),
  })
}

export const useUpdateProjectTemplate = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      templateId,
      payload,
    }: {
      templateId: string
      payload: ProjectTemplatePayload
    }) => {
      const { data } = await apiClient.patch<{ data: ProjectTemplate }>(
        `/company/project-templates/${templateId}`,
        payload
      )
      return data.data
    },
    onSuccess: () => invalidateTemplates(queryClient),
  })
}

export const useArchiveProjectTemplate = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (templateId: string) => {
      const { data } = await apiClient.delete<{ data: ProjectTemplate }>(
        `/company/project-templates/${templateId}`
      )
      return data.data
    },
    onSuccess: () => invalidateTemplates(queryClient),
  })
}

export const useCreateProjectFromTemplate = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      templateId,
      payload,
    }: {
      templateId: string
      payload: CreateProjectInput
    }) => {
      const { data } = await apiClient.post<{
        data: {
          project: Project
          template: { id: string; name: string }
          applied: {
            parties: number
            folders: number
            locations: number
            assignments: number
          }
        }
      }>(`/company/project-templates/${templateId}/create-project`, payload)
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['companies'] })
      invalidateTemplates(queryClient)
    },
  })
}
