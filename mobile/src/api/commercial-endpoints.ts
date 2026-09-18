/**
 * Commercial, workflow and procurement calls (M6). The app raises change
 * events, reads change orders, commitments and pay applications, submits a
 * pay application for a party that holds it, answers workflow steps through
 * the respond route, and acknowledges lead-time alerts. It approves,
 * certifies and pays nothing: those routes are never called from here.
 */
import { api, run } from '@/api/client'
import type {
  ChangeEvent,
  ChangeEventCreate,
  ChangeEventList,
  ChangeOrder,
  Commitment,
  LeadTimeAlert,
  LongLeadItem,
  PayApp,
  ProcurementOverview,
  RegisterOrder,
  WorkflowInstance,
  WorkflowStepItem,
} from '@/api/commercial-types'

type Query = Record<string, string | number | boolean | undefined>
type PathParams = Record<string, string>

const get = <T>(path: string, options: { path?: PathParams; query?: Query; signal?: AbortSignal } = {}) =>
  run<T>(() => api.GET(path as never, { params: { path: options.path, query: options.query }, signal: options.signal } as never) as never)

const send = <T>(method: 'POST' | 'PATCH', path: string, options: { path?: PathParams; body?: unknown } = {}) =>
  run<T>(() => (api[method] as typeof api.POST)(path as never, { params: { path: options.path }, body: options.body } as never) as never)

const rows = <T>(data: { items?: T[] } | T[]): T[] => (Array.isArray(data) ? data : (data.items ?? []))

// ── Change events ──

export interface ChangeEventFilters {
  status?: string
  type?: string
  origin?: string
  q?: string
}

export const listChangeEvents = (projectId: string, filters: ChangeEventFilters = {}, signal?: AbortSignal) =>
  get<ChangeEventList>('/projects/{projectId}/change-events', { path: { projectId }, query: { status: filters.status, type: filters.type, origin: filters.origin, q: filters.q || undefined }, signal })

export const getChangeEvent = (projectId: string, changeEventId: string, signal?: AbortSignal) => get<ChangeEvent>('/projects/{projectId}/change-events/{changeEventId}', { path: { projectId, changeEventId }, signal })

export const createChangeEvent = (projectId: string, body: ChangeEventCreate) => send<ChangeEvent>('POST', '/projects/{projectId}/change-events', { path: { projectId }, body })

// ── Change orders, commitments, pay applications ──

/** The register answers `{ orders, summary }`, unlike the other lists. */
export const listChangeOrders = async (projectId: string, status?: string, signal?: AbortSignal) => {
  const data = await get<{ orders?: ChangeOrder[]; items?: ChangeOrder[] } | ChangeOrder[]>('/projects/{projectId}/change-orders', { path: { projectId }, query: { status }, signal })
  return Array.isArray(data) ? data : (data.orders ?? data.items ?? [])
}

export const listCommitments = async (projectId: string, signal?: AbortSignal) => rows(await get<{ items: Commitment[] } | Commitment[]>('/projects/{projectId}/commitments', { path: { projectId }, signal }))

export const getCommitment = (projectId: string, commitmentId: string, signal?: AbortSignal) => get<Commitment>('/projects/{projectId}/commitments/{commitmentId}', { path: { projectId, commitmentId }, signal })

export const listPayApps = async (projectId: string, status?: string, signal?: AbortSignal) => rows(await get<{ items: PayApp[] } | PayApp[]>('/projects/{projectId}/pay-apps', { path: { projectId }, query: { status }, signal }))

export const getPayApp = (projectId: string, payAppId: string, signal?: AbortSignal) => get<PayApp>('/projects/{projectId}/pay-apps/{payAppId}', { path: { projectId, payAppId }, signal })

/** Draft → submitted. The only pay-application write the app makes; review, approve and pay stay on the web. */
export const submitPayApp = (projectId: string, payAppId: string) => send<PayApp>('POST', '/projects/{projectId}/pay-apps/{payAppId}/submit', { path: { projectId, payAppId }, body: {} })

// ── Workflow inbox ──

export const listMySteps = async (signal?: AbortSignal) => rows(await get<{ items: WorkflowStepItem[] }>('/workflows/my-steps', { signal }))

export const getWorkflowInstance = (projectId: string, instanceId: string, signal?: AbortSignal) => get<WorkflowInstance>('/projects/{projectId}/workflows/instances/{instanceId}', { path: { projectId, instanceId }, signal })

export const respondToStep = (projectId: string, instanceId: string, body: { response: string; comment?: string }) =>
  send<WorkflowInstance>('POST', '/projects/{projectId}/workflows/instances/{instanceId}/respond', { path: { projectId, instanceId }, body })

// ── Procurement ──

export const getProcurementOverview = (projectId: string, signal?: AbortSignal) => get<ProcurementOverview>('/projects/{projectId}/procurement', { path: { projectId }, signal })

export const listLeadTimeAlerts = async (projectId: string, status?: string, signal?: AbortSignal) => rows(await get<{ items: LeadTimeAlert[] } | LeadTimeAlert[]>('/projects/{projectId}/procurement/lead-time-alerts', { path: { projectId }, query: { status }, signal }))

/** The only alert write: the legacy setter accepts `acknowledged` and nothing else. */
export const acknowledgeAlert = (projectId: string, alertId: string) => send<LeadTimeAlert>('PATCH', '/projects/{projectId}/procurement/lead-time-alerts/{alertId}', { path: { projectId, alertId }, body: { status: 'acknowledged' } })

export const listRegisterOrders = async (projectId: string, status?: string, signal?: AbortSignal) => rows(await get<{ items: RegisterOrder[] }>('/projects/{projectId}/purchase-orders', { path: { projectId }, query: { status }, signal }))

export const getRegisterOrder = (projectId: string, orderId: string, signal?: AbortSignal) => get<RegisterOrder>('/projects/{projectId}/purchase-orders/{orderId}', { path: { projectId, orderId }, signal })

export const listLongLead = async (projectId: string, signal?: AbortSignal) => rows(await get<{ items: LongLeadItem[] } | LongLeadItem[]>('/projects/{projectId}/long-lead', { path: { projectId }, signal }))
