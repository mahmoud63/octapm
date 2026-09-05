import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Configurable workflow engine (OCTA-PLAT-WF-024).
 *
 * Templates live in the company library (`projectId: null`) or on one
 * project; instances run on a record of a tool (change order, commitment,
 * pay application…) and, when they reach an end, apply the outcome through
 * the record's own service.
 */

export type WorkflowToolKey =
  | 'change_order'
  | 'commitment'
  | 'sub_pay_app'
  | 'ipc_certificate'
  | 'budget_revision'
  | 'submittal'
  | 'correspondence'
  | 'document_revision'

export type WorkflowStepType = 'response' | 'condition' | 'action'
export type WorkflowResponseTone = 'positive' | 'negative' | 'neutral'
export type WorkflowInstanceStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export const CONDITION_OPS = [
  { id: 'eq', label: 'equals', needsValue: true },
  { id: 'neq', label: 'does not equal', needsValue: true },
  { id: 'gt', label: 'greater than', needsValue: true },
  { id: 'gte', label: 'at least', needsValue: true },
  { id: 'lt', label: 'less than', needsValue: true },
  { id: 'lte', label: 'at most', needsValue: true },
  { id: 'in', label: 'is one of', needsValue: true },
  { id: 'nin', label: 'is none of', needsValue: true },
  { id: 'contains', label: 'contains', needsValue: true },
  { id: 'is_true', label: 'is true', needsValue: false },
  { id: 'is_false', label: 'is false', needsValue: false },
  { id: 'empty', label: 'is empty', needsValue: false },
  { id: 'not_empty', label: 'is set', needsValue: false },
] as const
export type ConditionOp = (typeof CONDITION_OPS)[number]['id']

export const END_SUCCESS = 'end_success'
export const END_FAIL = 'end_fail'

export interface WorkflowAssignee {
  type: 'user' | 'role' | 'party_role' | 'permission_template'
  userId?: string | null
  role?: string | null
  templateId?: string | null
}

export interface WorkflowCondition {
  field: string
  op: ConditionOp
  value: unknown
}

export interface WorkflowResponse {
  key?: string
  label: string
  next: string
  tone?: WorkflowResponseTone
  requireComment?: boolean
}

export interface WorkflowAction {
  type: 'notify'
  roles?: string[]
  userIds?: string[]
  message?: string | null
}

export interface WorkflowStep {
  key: string
  name: string
  type: WorkflowStepType
  description?: string | null
  assignees?: WorkflowAssignee[]
  requireAll?: boolean
  days?: number | null
  escalateRoles?: string[]
  responses?: WorkflowResponse[]
  condition?: WorkflowCondition | null
  whenTrue?: string | null
  whenFalse?: string | null
  action?: WorkflowAction | null
  next?: string | null
}

export interface WorkflowContextField {
  key: string
  label: string
  type: 'number' | 'string' | 'boolean'
}

export interface WorkflowTool {
  key: WorkflowToolKey
  label: string
  module: string
  triggerStatus: string | null
  outcomes: { success: string; fail: string }
  contextFields: WorkflowContextField[]
}

export interface WorkflowTemplate {
  id: string
  projectId: string | null
  scope: 'company' | 'project'
  tool: WorkflowToolKey
  toolLabel: string
  name: string
  description: string | null
  isDefault: boolean
  priority: number
  status: 'active' | 'archived'
  rules: WorkflowCondition[]
  steps: WorkflowStep[]
  startStep: string | null
  isSystem: boolean
  instanceCount: number | null
  createdBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface WorkflowTemplateInput {
  tool?: WorkflowToolKey
  name?: string
  description?: string | null
  isDefault?: boolean
  priority?: number
  status?: 'active' | 'archived'
  rules?: WorkflowCondition[]
  steps?: WorkflowStep[]
  startStep?: string | null
}

export interface WorkflowAssignment {
  id: string
  userId: string
  user: { id: string; name: string | null; email: string | null } | null
  status: 'pending' | 'responded' | 'skipped'
  response: string | null
  responseLabel: string | null
  comment: string | null
  isOverride: boolean
  dueAt: string | null
  respondedAt: string | null
  escalatedAt: string | null
  overdue: boolean
}

export interface WorkflowInstanceStep extends WorkflowStep {
  status: 'pending' | 'active' | 'done' | string
  result: string | boolean | null
  startedAt: string | null
  dueAt: string | null
  completedAt: string | null
  assignments: WorkflowAssignment[]
}

export interface WorkflowInstance {
  id: string
  projectId: string
  project: { id: string; name: string } | null
  tool: WorkflowToolKey
  toolLabel: string
  recordId: string
  recordRef: string | null
  recordTitle: string | null
  path: string | null
  template: { id: string; name: string | null }
  status: WorkflowInstanceStatus
  outcome: 'success' | 'fail' | null
  currentStepKey: string | null
  currentStep: WorkflowInstanceStep | null
  steps: WorkflowInstanceStep[]
  context: Record<string, unknown>
  applyStatus: 'applied' | 'failed' | 'skipped' | null
  applyError: string | null
  escalationLevel: number
  startedAt: string | null
  startedBy: string | null
  completedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  myAssignment: {
    id: string
    dueAt: string | null
    responses: WorkflowResponse[]
  } | null
  updatedAt: string | null
}

export interface MyWorkflowStep {
  assignmentId: string
  instanceId: string
  projectId: string
  project: { id: string; name: string } | null
  tool: WorkflowToolKey
  toolLabel: string
  recordId: string
  recordRef: string | null
  recordTitle: string | null
  path: string | null
  template: { id: string; name: string } | null
  stepKey: string
  stepName: string
  responses: WorkflowResponse[]
  dueAt: string | null
  overdue: boolean
  escalatedAt: string | null
  createdAt: string | null
}

const rootKey = ['workflow-engine'] as const
const templatesKey = (projectId: string | null) =>
  [...rootKey, 'templates', projectId ?? 'company'] as const
const instancesKey = (projectId: string) =>
  [...rootKey, 'instances', projectId] as const
const myStepsKey = (projectId: string | null) =>
  [...rootKey, 'my-steps', projectId ?? 'all'] as const

const templatesBase = (projectId: string | null) =>
  projectId
    ? `/projects/${projectId}/workflows/templates`
    : '/company/workflow-templates'
const toolsPath = (projectId: string | null) =>
  projectId
    ? `/projects/${projectId}/workflows/tools`
    : '/company/workflow-tools'
const instancesBase = (projectId: string) =>
  `/projects/${projectId}/workflows/instances`

/** Record caches an outcome can change; invalidated after every response. */
const RECORD_KEYS = [
  'change-orders',
  'commitments',
  'pay-apps',
  'ipc',
  'ipcs',
  'budget-revisions',
  'submittals',
  'correspondence',
  'doc-control',
  'audit-events',
  'notifications',
  'workspace-dashboard',
]

const invalidateInstances = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: [...rootKey, 'instances', projectId] })
  qc.invalidateQueries({ queryKey: [...rootKey, 'my-steps'] })
  for (const key of RECORD_KEYS) {
    qc.invalidateQueries({ queryKey: [key, projectId] })
    qc.invalidateQueries({ queryKey: [key] })
  }
}

const invalidateTemplates = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string | null
) => {
  qc.invalidateQueries({ queryKey: [...rootKey, 'templates'] })
  if (projectId) qc.invalidateQueries({ queryKey: templatesKey(projectId) })
}

export const useWorkflowTools = (
  projectId: string | null,
  options: { enabled?: boolean } = {}
) =>
  useQuery<WorkflowTool[]>({
    queryKey: [...rootKey, 'tools', projectId ?? 'company'],
    queryFn: () =>
      apiClient
        .get(toolsPath(projectId))
        .then((response) => response.data.data.tools as WorkflowTool[]),
    staleTime: 5 * 60_000,
    enabled: options.enabled ?? true,
  })

export const useWorkflowTemplates = (
  projectId: string | null,
  query: { tool?: WorkflowToolKey | null; includeArchived?: boolean } = {},
  options: { enabled?: boolean } = {}
) =>
  useQuery<WorkflowTemplate[]>({
    queryKey: [...templatesKey(projectId), query],
    queryFn: () =>
      apiClient
        .get(templatesBase(projectId), {
          params: {
            ...(query.tool ? { tool: query.tool } : {}),
            ...(query.includeArchived ? { includeArchived: true } : {}),
          },
        })
        .then((response) => response.data.data.items as WorkflowTemplate[]),
    enabled: options.enabled ?? true,
  })

export const useCreateWorkflowTemplate = (projectId: string | null) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: WorkflowTemplateInput) =>
      apiClient
        .post(templatesBase(projectId), payload)
        .then((response) => response.data.data as WorkflowTemplate),
    onSuccess: () => invalidateTemplates(qc, projectId),
  })
}

export const useUpdateWorkflowTemplate = (projectId: string | null) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      templateId,
      payload,
    }: {
      templateId: string
      payload: WorkflowTemplateInput
    }) =>
      apiClient
        .patch(`${templatesBase(projectId)}/${templateId}`, payload)
        .then((response) => response.data.data as WorkflowTemplate),
    onSuccess: () => invalidateTemplates(qc, projectId),
  })
}

export const useArchiveWorkflowTemplate = (projectId: string | null) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (templateId: string) =>
      apiClient
        .delete(`${templatesBase(projectId)}/${templateId}`)
        .then((response) => response.data.data as WorkflowTemplate),
    onSuccess: () => invalidateTemplates(qc, projectId),
  })
}

/** Company library only: one default per tool plus a worked example. */
export const useSeedWorkflowDefaults = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiClient.post('/company/workflow-templates/defaults', {}).then(
        (response) =>
          response.data.data as {
            created: number
            templates: WorkflowTemplate[]
          }
      ),
    onSuccess: () => invalidateTemplates(qc, null),
  })
}

export const useWorkflowInstances = (
  projectId: string,
  query: {
    tool?: WorkflowToolKey | null
    recordId?: string | null
    status?: WorkflowInstanceStatus | null
    limit?: number
  } = {},
  options: { enabled?: boolean } = {}
) =>
  useQuery<WorkflowInstance[]>({
    queryKey: [...instancesKey(projectId), query],
    queryFn: () =>
      apiClient
        .get(instancesBase(projectId), {
          params: Object.fromEntries(
            Object.entries(query).filter(
              ([, value]) => value !== undefined && value !== null
            )
          ),
        })
        .then((response) => response.data.data.items as WorkflowInstance[]),
    enabled: Boolean(projectId) && (options.enabled ?? true),
  })

export const useWorkflowInstance = (
  projectId: string,
  instanceId: string | null
) =>
  useQuery<WorkflowInstance>({
    queryKey: [...instancesKey(projectId), 'detail', instanceId ?? ''],
    queryFn: () =>
      apiClient
        .get(`${instancesBase(projectId)}/${instanceId}`)
        .then((response) => response.data.data as WorkflowInstance),
    enabled: Boolean(projectId && instanceId),
  })

export const useStartWorkflow = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      tool: WorkflowToolKey
      recordId: string
      templateId?: string | null
    }) =>
      apiClient
        .post(instancesBase(projectId), payload)
        .then((response) => response.data.data as WorkflowInstance),
    onSuccess: () => invalidateInstances(qc, projectId),
  })
}

export const useRespondWorkflow = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      instanceId,
      response,
      comment,
    }: {
      instanceId: string
      response: string
      comment?: string | null
    }) =>
      apiClient
        .post(`${instancesBase(projectId)}/${instanceId}/respond`, {
          response,
          comment: comment || null,
        })
        .then((result) => result.data.data as WorkflowInstance),
    onSuccess: () => invalidateInstances(qc, projectId),
  })
}

export const useCancelWorkflow = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      instanceId,
      reason,
    }: {
      instanceId: string
      reason?: string | null
    }) =>
      apiClient
        .post(`${instancesBase(projectId)}/${instanceId}/cancel`, {
          reason: reason || null,
        })
        .then((response) => response.data.data as WorkflowInstance),
    onSuccess: () => invalidateInstances(qc, projectId),
  })
}

/** Steps waiting on the signed-in user — every project, or one. */
export const useMyWorkflowSteps = (projectId: string | null = null) =>
  useQuery<MyWorkflowStep[]>({
    queryKey: myStepsKey(projectId),
    queryFn: () =>
      apiClient
        .get(
          projectId
            ? `/projects/${projectId}/workflows/my-steps`
            : '/workflows/my-steps'
        )
        .then((response) => response.data.data.items as MyWorkflowStep[]),
    refetchInterval: 60_000,
  })

// ─── helpers shared by the editor, the panel and the dashboard card ────────

export const INSTANCE_STATUS_LABEL: Record<WorkflowInstanceStatus, string> = {
  running: 'In progress',
  succeeded: 'Completed',
  failed: 'Ended – not approved',
  cancelled: 'Cancelled',
}

export const STEP_TYPE_LABEL: Record<WorkflowStepType, string> = {
  response: 'Decision',
  condition: 'Branch',
  action: 'Notify',
}

export const targetLabel = (
  target: string | null | undefined,
  steps: Array<{ key: string; name: string }>
) => {
  if (!target) return '—'
  if (target === END_SUCCESS) return 'Finish – approved'
  if (target === END_FAIL) return 'Finish – not approved'
  return steps.find((step) => step.key === target)?.name ?? target
}

export const formatWorkflowDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : '—'

/**
 * Server record paths look like
 * `/projects/{id}/{module}/{child}?recordId=…`; the workspace route reads
 * module / child / recordId from search, so map them across.
 */
export const workspaceLink = (path: string | null | undefined) => {
  if (!path) return null
  const [pathname, queryString = ''] = path.split('?')
  const match = /^\/projects\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(
    pathname
  )
  if (!match) return null
  const search = new URLSearchParams(queryString)
  return {
    projectId: decodeURIComponent(match[1]),
    search: {
      module: match[2] ? decodeURIComponent(match[2]) : undefined,
      child: match[3] ? decodeURIComponent(match[3]) : undefined,
      recordId: search.get('recordId') ?? undefined,
    },
  }
}
