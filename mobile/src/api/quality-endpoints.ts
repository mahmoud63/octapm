/**
 * Quality calls (M4). State changes go through the API's own routes: form
 * start, responses, complete, close, reopen, void, deficiency; punch
 * transitions; NCR and safety submit, approve, reject, reopen; a material
 * test's result. Closeout evidence for NCRs and safety incidents must come
 * from the workflow upload route, as the server requires.
 */
import { api, run } from '@/api/client'
import type {
  CloseoutInput,
  FormCreate,
  FormInstance,
  FormList,
  FormTemplate,
  MaterialTest,
  MaterialTestList,
  Ncr,
  NcrCreate,
  NcrList,
  PunchAction,
  PunchCreate,
  PunchItem,
  PunchList,
  QualityDashboard,
  SafetyCreate,
  SafetyIncident,
  SafetyList,
  WorkflowUpload,
} from '@/api/quality-types'

type Query = Record<string, string | number | boolean | undefined>
type PathParams = Record<string, string>

const get = <T>(path: string, options: { path?: PathParams; query?: Query; signal?: AbortSignal } = {}) =>
  run<T>(() => api.GET(path as never, { params: { path: options.path, query: options.query }, signal: options.signal } as never) as never)

const send = <T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, options: { path?: PathParams; body?: unknown } = {}) =>
  run<T>(() => (api[method] as typeof api.POST)(path as never, { params: { path: options.path }, body: options.body } as never) as never)

const uploadForm = <T>(path: string, form: FormData, options: { path?: PathParams } = {}) =>
  run<T>(() => api.POST(path as never, { params: { path: options.path }, body: form, bodySerializer: (body: FormData) => body } as never) as never)

// ── Dashboard ──

export const getQualityDashboard = (projectId: string, signal?: AbortSignal) => get<QualityDashboard>('/projects/{projectId}/quality/dashboard', { path: { projectId }, signal })

// ── Inspections and forms ──

export const listFormTemplates = (projectId: string, signal?: AbortSignal) =>
  get<{ items: FormTemplate[] }>('/projects/{projectId}/forms/templates', { path: { projectId }, query: { status: 'active' }, signal })

export interface FormFilters {
  status?: string
  type?: string
  ballInCourt?: boolean
  overdue?: boolean
  search?: string
  activityId?: string
}

export const listForms = (projectId: string, filters: FormFilters = {}, signal?: AbortSignal) =>
  get<FormList>('/projects/{projectId}/forms', {
    path: { projectId },
    query: { status: filters.status, type: filters.type, ballInCourtUserId: filters.ballInCourt ? 'me' : undefined, overdue: filters.overdue ? true : undefined, search: filters.search || undefined, activityId: filters.activityId, limit: 200 },
    signal,
  })

export const getForm = (projectId: string, instanceId: string, signal?: AbortSignal) => get<FormInstance>('/projects/{projectId}/forms/{instanceId}', { path: { projectId, instanceId }, signal })

export const createForm = (projectId: string, body: FormCreate) => send<FormInstance>('POST', '/projects/{projectId}/forms', { path: { projectId }, body })

export const startForm = (projectId: string, instanceId: string) => send<FormInstance>('POST', '/projects/{projectId}/forms/{instanceId}/start', { path: { projectId, instanceId }, body: {} })

export const saveFormResponses = (projectId: string, instanceId: string, responses: { itemId: string; value: string | number | boolean | null; note?: string }[]) =>
  send<FormInstance>('PUT', '/projects/{projectId}/forms/{instanceId}/responses', { path: { projectId, instanceId }, body: { responses } })

export const completeForm = (projectId: string, instanceId: string) => send<FormInstance>('POST', '/projects/{projectId}/forms/{instanceId}/complete', { path: { projectId, instanceId }, body: {} })

export const formAction = (projectId: string, instanceId: string, action: 'close' | 'reopen' | 'void', reason?: string) =>
  send<FormInstance>('POST', `/projects/{projectId}/forms/{instanceId}/${action}`, { path: { projectId, instanceId }, body: reason ? { reason } : {} })

export const raiseDeficiency = (projectId: string, instanceId: string, itemId: string, body: { target: 'punch_item' | 'observation'; observationType?: string; hazard?: string; title?: string; description?: string; assigneeCompanyId?: string; assigneeUserId?: string; dueDate?: string }) =>
  send<{ record: PunchItem; instance: FormInstance }>('POST', '/projects/{projectId}/forms/{instanceId}/items/{itemId}/deficiency', { path: { projectId, instanceId, itemId }, body })

export const addFormSignature = (projectId: string, instanceId: string, body: { role: string; image: string; signerName?: string; signerCompany?: string; itemId?: string }) =>
  send<{ signature: unknown; instance: FormInstance }>('POST', '/projects/{projectId}/forms/{instanceId}/signatures', { path: { projectId, instanceId }, body })

// ── Punch items and observations ──

export interface PunchFilters {
  kind?: 'punch' | 'observation' | 'all'
  status?: string
  ballInCourt?: boolean
  overdue?: boolean
  search?: string
  locationId?: string
  sheetId?: string
}

export const listPunch = (projectId: string, filters: PunchFilters = {}, signal?: AbortSignal) =>
  get<PunchList>('/projects/{projectId}/punch', {
    path: { projectId },
    query: { kind: filters.kind ?? 'all', status: filters.status, ballInCourtUserId: filters.ballInCourt ? 'me' : undefined, overdue: filters.overdue ? true : undefined, search: filters.search || undefined, locationId: filters.locationId, sheetId: filters.sheetId, limit: 300 },
    signal,
  })

export const getPunch = (projectId: string, itemId: string, signal?: AbortSignal) => get<PunchItem>('/projects/{projectId}/punch/{itemId}', { path: { projectId, itemId }, signal })

export const createPunch = (projectId: string, body: PunchCreate) => send<PunchItem & { replayed?: boolean }>('POST', '/projects/{projectId}/punch', { path: { projectId }, body })

export const transitionPunch = (projectId: string, itemId: string, action: PunchAction, reason?: string) =>
  send<PunchItem>('POST', '/projects/{projectId}/punch/{itemId}/transition', { path: { projectId, itemId }, body: { action, reason } })

// ── NCRs ──

export const listNcrs = (projectId: string, signal?: AbortSignal) => get<NcrList>('/projects/{projectId}/ncr', { path: { projectId }, signal })

export const createNcr = (projectId: string, body: NcrCreate) => send<Ncr>('POST', '/projects/{projectId}/ncr', { path: { projectId }, body: { ...body, status: 'open' } })

export const submitNcrCloseout = (projectId: string, ncrId: string, body: CloseoutInput) => send<Ncr>('POST', '/projects/{projectId}/ncr/{ncrId}/submit', { path: { projectId, ncrId }, body })

export const ncrDecision = (projectId: string, ncrId: string, action: 'approve' | 'reject' | 'reopen', text?: string) =>
  send<Ncr>('POST', `/projects/{projectId}/ncr/{ncrId}/${action}`, { path: { projectId, ncrId }, body: action === 'approve' ? { comment: text } : { reason: text } })

// ── Safety ──

export const listSafety = (projectId: string, signal?: AbortSignal) => get<SafetyList>('/projects/{projectId}/safety', { path: { projectId }, signal })

export const createSafety = (projectId: string, body: SafetyCreate) => send<SafetyIncident>('POST', '/projects/{projectId}/safety', { path: { projectId }, body })

export const submitSafetyCloseout = (projectId: string, incidentId: string, body: CloseoutInput) =>
  send<SafetyIncident>('POST', '/projects/{projectId}/safety/{incidentId}/submit', { path: { projectId, incidentId }, body })

export const safetyDecision = (projectId: string, incidentId: string, action: 'approve' | 'reject' | 'reopen', text?: string) =>
  send<SafetyIncident>('POST', `/projects/{projectId}/safety/{incidentId}/${action}`, { path: { projectId, incidentId }, body: action === 'approve' ? { comment: text } : { reason: text } })

// ── Material tests ──

export const listMaterialTests = (projectId: string, signal?: AbortSignal) => get<MaterialTestList>('/projects/{projectId}/material-tests', { path: { projectId }, signal })

export const createMaterialTest = (projectId: string, body: { testType: string; activityId?: string; dueDate?: string; specValue?: string; labName?: string; notes?: string }) =>
  send<MaterialTest>('POST', '/projects/{projectId}/material-tests', { path: { projectId }, body: { ...body, result: 'pending' } })

export const recordMaterialTest = (projectId: string, testId: string, body: { result: 'pass' | 'fail' | 'pending'; actualValue?: string; testDate?: string; labName?: string; millCertRef?: string; notes?: string }) =>
  send<MaterialTest>('PATCH', '/projects/{projectId}/material-tests/{testId}', { path: { projectId, testId }, body })

// ── Closeout evidence ──

/** Evidence for an NCR or safety closeout must be uploaded here, not through the unified attachment route. */
export const uploadWorkflowFiles = (projectId: string, files: { uri: string; name: string; type: string }[] | File[]) => {
  const form = new FormData()
  for (const file of files) form.append('files', file as unknown as Blob)
  return uploadForm<WorkflowUpload[]>('/projects/{projectId}/workflow/uploads', form, { path: { projectId } })
}
