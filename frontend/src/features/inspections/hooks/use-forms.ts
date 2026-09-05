import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export const FORM_TYPES = ['inspection', 'itp', 'form', 'talk'] as const
export type FormType = (typeof FORM_TYPES)[number]
export const FORM_TYPE_LABEL: Record<FormType, string> = {
  inspection: 'Inspection',
  itp: 'ITP',
  form: 'Form',
  talk: 'Toolbox talk',
}

export const FORM_STATUSES = [
  'scheduled',
  'in_progress',
  'complete',
  'closed',
  'void',
] as const
export type FormStatus = (typeof FORM_STATUSES)[number]
export const FORM_STATUS_LABEL: Record<FormStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  complete: 'Complete',
  closed: 'Closed',
  void: 'Void',
}

export const RESPONSE_TYPES = [
  'pass_fail',
  'yes_no',
  'checkbox',
  'text',
  'number',
  'choice',
  'date',
  'photo',
  'signature',
] as const
export type ResponseType = (typeof RESPONSE_TYPES)[number]
export const RESPONSE_TYPE_LABEL: Record<ResponseType, string> = {
  pass_fail: 'Pass / fail',
  yes_no: 'Yes / no',
  checkbox: 'Checkbox',
  text: 'Text',
  number: 'Number',
  choice: 'Choice',
  date: 'Date',
  photo: 'Photo',
  signature: 'Signature',
}

export const SIGNATURE_ROLES = [
  'inspector',
  'approver',
  'subcontractor',
  'witness',
  'attendee',
] as const
export type SignatureRole = (typeof SIGNATURE_ROLES)[number]

export type NumberOptions = {
  min: number | null
  max: number | null
  unit: string | null
}

export interface FormItem {
  id: string
  sectionId: string
  sortOrder: number
  label: string
  description: string | null
  responseType: ResponseType
  required: boolean
  photoRequired: boolean
  isHoldPoint: boolean
  inspectionPointType: 'hold' | 'witness' | 'review' | null
  options: string[] | NumberOptions | null
  reference: string | null
}

export interface FormSection {
  id: string
  title: string
  description: string | null
  sortOrder: number
  items: FormItem[]
}

export interface FormTemplateSettings {
  requireSignatures: SignatureRole[]
  deficiencyTarget: 'punch_item' | 'observation'
  instructions: string | null
}

export interface FormTemplate {
  id: string
  orgId: string
  projectId: string | null
  scope: 'company' | 'project'
  sourceTemplateId: string | null
  type: FormType
  typeLabel: string
  name: string
  description: string | null
  trade: string | null
  version: number
  status: 'draft' | 'active' | 'archived'
  isSystem: boolean
  settings: FormTemplateSettings
  sectionCount: number
  itemCount: number
  holdPointCount: number
  instanceCount: number
  sections?: FormSection[]
  editable: boolean
  createdAt: string
  updatedAt: string
}

export interface FormItemInput {
  id?: string
  label: string
  description?: string | null
  responseType: ResponseType
  required?: boolean
  photoRequired?: boolean
  isHoldPoint?: boolean
  inspectionPointType?: 'hold' | 'witness' | 'review' | null
  options?: string[] | NumberOptions | null
  reference?: string | null
}

export interface FormSectionInput {
  id?: string
  title: string
  description?: string | null
  items: FormItemInput[]
}

export interface FormTemplateInput {
  name?: string
  description?: string | null
  trade?: string | null
  type?: FormType
  status?: 'draft' | 'active' | 'archived'
  settings?: Partial<FormTemplateSettings>
  sections?: FormSectionInput[]
}

export interface FormItemResponse {
  id: string
  value: string | null
  numberValue: number | null
  note: string | null
  isDeficient: boolean
  deficiencyRecordType: string | null
  deficiencyRecordId: string | null
  deficiencyPath: string | null
  answeredBy: string | null
  answeredAt: string | null
  photoCount: number
}

export interface FormSignature {
  id: string
  role: SignatureRole
  itemId: string | null
  userId: string | null
  userName: string | null
  signerName: string
  signerCompany: string | null
  documentId: string | null
  imageUrl: string | null
  signedAt: string
}

export interface FormInstanceItem extends FormItem {
  response: FormItemResponse | null
  signature: FormSignature | null
}

export interface FormHoldPoint {
  instanceId: string
  ref: string
  title: string
  itemId: string
  label: string
  state: 'pending' | 'failed' | 'passed'
  status: string
}

export interface FormSummary {
  total: number
  required: number
  answered: number
  passed: number
  failed: number
  na: number
  deficient: number
  holdPoints: number
  holdPointsOpen: number
}

interface Person {
  id: string
  name: string
  email?: string | null
}

export interface FormRecurrence {
  every: 'day' | 'week' | 'month'
  interval: number
  until: string | null
}

export interface FormInstance {
  id: string
  projectId: string
  templateId: string
  templateVersion: number
  template: {
    id: string
    name: string
    type: FormType
    version: number
    settings: FormTemplateSettings
    isSystem: boolean
  } | null
  number: number
  ref: string
  type: FormType
  typeLabel: string
  title: string
  status: FormStatus
  outcome: 'pass' | 'fail' | null
  activityId: string | null
  activity: { id: string; name: string } | null
  locationId: string | null
  location: {
    id: string
    name: string
    code: string | null
    path: string
  } | null
  sheetId: string | null
  sheet: { id: string; number: string; title: string } | null
  assigneeUserId: string | null
  assigneeUser: Person | null
  assigneeCompanyId: string | null
  assigneeCompany: { id: string; name: string } | null
  inspectorUserId: string | null
  inspectorUser: Person | null
  approverUserId: string | null
  approverUser: Person | null
  ballInCourtUserId: string | null
  ballInCourtUser: { id: string; name: string } | null
  scheduledFor: string | null
  dueDate: string | null
  isOverdue: boolean
  recurrence: FormRecurrence | null
  startedAt: string | null
  completedAt: string | null
  completedBy: string | null
  closedAt: string | null
  closedBy: string | null
  reopenReason: string | null
  summary: FormSummary | null
  clientRequestId: string | null
  legacyItpId: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  path: string | null
  sections?: Array<{
    id: string
    title: string
    description: string | null
    items: FormInstanceItem[]
  }>
  signatures?: FormSignature[]
  holdPoints?: FormHoldPoint[]
  nextInstance?: FormInstance | null
}

export interface FormInstanceInput {
  templateId?: string
  title?: string | null
  activityId?: string | null
  locationId?: string | null
  sheetId?: string | null
  assigneeUserId?: string | null
  assigneeCompanyId?: string | null
  inspectorUserId?: string | null
  approverUserId?: string | null
  scheduledFor?: string | null
  dueDate?: string | null
  recurrence?: FormRecurrence | null
  startNow?: boolean
  clientRequestId?: string | null
}

export interface FormFilters {
  status?: string
  type?: FormType | ''
  templateId?: string | null
  activityId?: string | null
  locationId?: string | null
  sheetId?: string | null
  assigneeUserId?: string | null
  assigneeCompanyId?: string | null
  ballInCourtUserId?: string | null
  outcome?: 'pass' | 'fail' | ''
  overdue?: boolean
  search?: string
  limit?: number
}

export interface FormListResponse {
  items: FormInstance[]
  summary: {
    total: number
    open: number
    overdue: number
    failed: number
    awaitingClose: number
    holdPointsOpen: number
    byStatus: Partial<Record<FormStatus, number>>
    byType: Partial<Record<FormType, number>>
  }
}

export interface FormTemplateListResponse {
  items: FormTemplate[]
  summary: {
    total: number
    byType: Partial<Record<FormType, number>>
    company: number
    project: number
  }
}

export type CompletionProblem = {
  itemId?: string
  label: string
  reason: 'answer' | 'photo' | 'signature' | 'signature_role'
  role?: string
}

export const formKeys = {
  instances: (projectId: string, filters: FormFilters) =>
    ['forms', projectId, filters] as const,
  instance: (projectId: string, instanceId: string) =>
    ['form-instance', projectId, instanceId] as const,
  holdPoints: (projectId: string, activityId: string) =>
    ['form-hold-points', projectId, activityId] as const,
  templates: (projectId: string | null, query: Record<string, unknown>) =>
    ['form-templates', projectId ?? 'company', query] as const,
}

const templateBase = (projectId: string | null) =>
  projectId
    ? `/projects/${projectId}/forms/templates`
    : '/company/form-templates'

const toParams = (filters: FormFilters) => ({
  status: filters.status || undefined,
  type: filters.type || undefined,
  templateId: filters.templateId || undefined,
  activityId: filters.activityId || undefined,
  locationId: filters.locationId || undefined,
  sheetId: filters.sheetId || undefined,
  assigneeUserId: filters.assigneeUserId || undefined,
  assigneeCompanyId: filters.assigneeCompanyId || undefined,
  ballInCourtUserId: filters.ballInCourtUserId || undefined,
  outcome: filters.outcome || undefined,
  overdue: filters.overdue ? 'true' : undefined,
  search: filters.search?.trim() || undefined,
  limit: filters.limit || undefined,
})

const invalidateForms = (
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string | null
) => {
  if (projectId) {
    queryClient.invalidateQueries({ queryKey: ['forms', projectId] })
    queryClient.invalidateQueries({ queryKey: ['form-instance', projectId] })
    queryClient.invalidateQueries({ queryKey: ['form-hold-points', projectId] })
    queryClient.invalidateQueries({ queryKey: ['audit-events', projectId] })
    queryClient.invalidateQueries({
      queryKey: ['quality-dashboard', projectId],
    })
    queryClient.invalidateQueries({ queryKey: ['punch', projectId] })
    queryClient.invalidateQueries({ queryKey: ['attachments', projectId] })
  }
  queryClient.invalidateQueries({ queryKey: ['form-templates'] })
}

// ─── Templates (project or company library) ─────────────────────────────

export const useFormTemplates = (
  projectId: string | null,
  query: {
    scope?: 'all' | 'project' | 'company'
    type?: FormType | ''
    includeArchived?: boolean
    search?: string
  } = {},
  options: { enabled?: boolean } = {}
) =>
  useQuery<FormTemplateListResponse>({
    queryKey: formKeys.templates(projectId, query),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: FormTemplateListResponse }>(
        templateBase(projectId),
        {
          params: {
            scope: projectId ? query.scope || 'all' : undefined,
            type: query.type || undefined,
            includeArchived: query.includeArchived ? 'true' : undefined,
            search: query.search?.trim() || undefined,
          },
        }
      )
      return data.data
    },
    enabled: options.enabled ?? true,
  })

export const useFormTemplate = (
  projectId: string | null,
  templateId: string | null
) =>
  useQuery<FormTemplate>({
    queryKey: ['form-template', projectId ?? 'company', templateId],
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: FormTemplate }>(
        `${templateBase(projectId)}/${templateId}`
      )
      return data.data
    },
    enabled: Boolean(templateId),
  })

/** Create / edit / archive / duplicate for either scope. */
export const useTemplateMutations = (projectId: string | null) => {
  const queryClient = useQueryClient()
  const base = templateBase(projectId)
  const done = () => {
    invalidateForms(queryClient, projectId)
    queryClient.invalidateQueries({ queryKey: ['form-template'] })
  }
  const create = useMutation({
    mutationFn: async (payload: FormTemplateInput) => {
      const { data } = await apiClient.post<{ data: FormTemplate }>(
        base,
        payload
      )
      return data.data
    },
    onSuccess: done,
  })
  const update = useMutation({
    mutationFn: async ({
      templateId,
      payload,
    }: {
      templateId: string
      payload: FormTemplateInput
    }) => {
      const { data } = await apiClient.patch<{ data: FormTemplate }>(
        `${base}/${templateId}`,
        payload
      )
      return data.data
    },
    onSuccess: done,
  })
  const archive = useMutation({
    mutationFn: async (templateId: string) => {
      const { data } = await apiClient.delete<{
        data: { id: string; status: string }
      }>(`${base}/${templateId}`)
      return data.data
    },
    onSuccess: done,
  })
  const duplicate = useMutation({
    mutationFn: async ({
      templateId,
      name,
      targetProjectId,
    }: {
      templateId: string
      name?: string | null
      targetProjectId?: string | null
    }) => {
      const { data } = await apiClient.post<{ data: FormTemplate }>(
        `${base}/${templateId}/duplicate`,
        projectId ? { name } : { name, targetProjectId }
      )
      return data.data
    },
    onSuccess: done,
  })
  const seedStarters = useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<{
        data: { created: number; items: FormTemplate[] }
      }>('/company/form-templates/starters')
      return data.data
    },
    onSuccess: done,
  })
  return { create, update, archive, duplicate, seedStarters }
}

// ─── Instances ──────────────────────────────────────────────────────────

export const useFormInstances = (
  projectId: string,
  filters: FormFilters = {},
  options: { enabled?: boolean } = {}
) =>
  useQuery<FormListResponse>({
    queryKey: formKeys.instances(projectId, filters),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: FormListResponse }>(
        `/projects/${projectId}/forms`,
        { params: toParams(filters) }
      )
      return data.data
    },
    enabled: (options.enabled ?? true) && Boolean(projectId),
  })

export const useFormInstance = (projectId: string, instanceId: string | null) =>
  useQuery<FormInstance>({
    queryKey: formKeys.instance(projectId, instanceId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: FormInstance }>(
        `/projects/${projectId}/forms/${instanceId}`
      )
      return data.data
    },
    enabled: Boolean(projectId && instanceId),
  })

export const useActivityHoldPoints = (
  projectId: string,
  activityId: string | null
) =>
  useQuery<{ activityId: string; open: number; holdPoints: FormHoldPoint[] }>({
    queryKey: formKeys.holdPoints(projectId, activityId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<{
        data: { activityId: string; open: number; holdPoints: FormHoldPoint[] }
      }>(`/projects/${projectId}/forms/hold-points`, { params: { activityId } })
      return data.data
    },
    enabled: Boolean(projectId && activityId),
    staleTime: 30_000,
  })

export const useCreateFormInstance = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: FormInstanceInput) => {
      const { data } = await apiClient.post<{ data: FormInstance }>(
        `/projects/${projectId}/forms`,
        payload
      )
      return data.data
    },
    onSuccess: () => invalidateForms(queryClient, projectId),
  })
}

export const useUpdateFormInstance = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      instanceId,
      payload,
    }: {
      instanceId: string
      payload: FormInstanceInput
    }) => {
      const { data } = await apiClient.patch<{ data: FormInstance }>(
        `/projects/${projectId}/forms/${instanceId}`,
        payload
      )
      return data.data
    },
    onSuccess: () => invalidateForms(queryClient, projectId),
  })
}

export const useDeleteFormInstance = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (instanceId: string) => {
      const { data } = await apiClient.delete<{
        data: { deleted: boolean; id: string }
      }>(`/projects/${projectId}/forms/${instanceId}`)
      return data.data
    },
    onSuccess: () => invalidateForms(queryClient, projectId),
  })
}

export const useSaveFormResponses = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      instanceId,
      responses,
    }: {
      instanceId: string
      responses: Array<{
        itemId: string
        value?: string | null
        note?: string | null
      }>
    }) => {
      const { data } = await apiClient.put<{ data: FormInstance }>(
        `/projects/${projectId}/forms/${instanceId}/responses`,
        { responses }
      )
      return data.data
    },
    onSuccess: (instance) => {
      queryClient.setQueryData(
        formKeys.instance(projectId, instance.id),
        instance
      )
      queryClient.invalidateQueries({ queryKey: ['forms', projectId] })
      queryClient.invalidateQueries({
        queryKey: ['form-hold-points', projectId],
      })
    },
  })
}

export type FormInstanceAction =
  | 'start'
  | 'complete'
  | 'close'
  | 'reopen'
  | 'void'

export const useFormInstanceAction = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      instanceId,
      action,
      reason,
    }: {
      instanceId: string
      action: FormInstanceAction
      reason?: string | null
    }) => {
      const { data } = await apiClient.post<{ data: FormInstance }>(
        `/projects/${projectId}/forms/${instanceId}/${action}`,
        reason ? { reason } : {}
      )
      return data.data
    },
    onSuccess: () => invalidateForms(queryClient, projectId),
  })
}

export const useSignFormInstance = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      instanceId,
      role,
      image,
      signerName,
      signerCompany,
      itemId,
    }: {
      instanceId: string
      role: SignatureRole
      image: string
      signerName?: string | null
      signerCompany?: string | null
      itemId?: string | null
    }) => {
      const { data } = await apiClient.post<{
        data: { signature: FormSignature; instance: FormInstance }
      }>(`/projects/${projectId}/forms/${instanceId}/signatures`, {
        role,
        image,
        signerName: signerName || undefined,
        signerCompany: signerCompany || undefined,
        itemId: itemId || undefined,
      })
      return data.data
    },
    onSuccess: () => invalidateForms(queryClient, projectId),
  })
}

export const useRaiseFormDeficiency = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      instanceId,
      itemId,
      payload = {},
    }: {
      instanceId: string
      itemId: string
      payload?: {
        title?: string | null
        priority?: 'low' | 'normal' | 'high' | 'urgent'
        assigneeCompanyId?: string | null
        assigneeUserId?: string | null
        dueDate?: string | null
      }
    }) => {
      const { data } = await apiClient.post<{
        data: {
          record: { id: string; ref: string; path?: string | null }
          instance: FormInstance
        }
      }>(
        `/projects/${projectId}/forms/${instanceId}/items/${itemId}/deficiency`,
        payload
      )
      return data.data
    },
    onSuccess: () => invalidateForms(queryClient, projectId),
  })
}

/** Downloads the filled-in form as PDF. */
export const downloadFormPdf = async (
  projectId: string,
  instanceId: string,
  options: { includePhotos?: boolean } = {}
) => {
  const response = await apiClient.get(
    `/projects/${projectId}/forms/${instanceId}/export.pdf`,
    {
      params: { includePhotos: options.includePhotos ? 'true' : undefined },
      responseType: 'blob',
      timeout: 120_000,
    }
  )
  const disposition = String(response.headers?.['content-disposition'] ?? '')
  const match = /filename="?([^";]+)"?/.exec(disposition)
  const fileName = match?.[1] ?? 'inspection.pdf'
  const url = URL.createObjectURL(
    new Blob([response.data], { type: 'application/pdf' })
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return fileName
}

/** Problems the server listed when a completion was refused (FORM_INCOMPLETE). */
export const completionProblemsFrom = (error: unknown): CompletionProblem[] => {
  const details = (
    error as {
      response?: {
        data?: { error?: { code?: string; details?: { problems?: unknown } } }
      }
    }
  )?.response?.data?.error
  if (details?.code !== 'FORM_INCOMPLETE') return []
  const problems = details.details?.problems
  return Array.isArray(problems) ? (problems as CompletionProblem[]) : []
}

export const formatFormDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : '—'

export const isFormOpen = (status: FormStatus) =>
  status === 'scheduled' || status === 'in_progress'
