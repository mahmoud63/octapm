/** Server state for the commercial, workflow and procurement screens (M6). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  acknowledgeAlert,
  createChangeEvent,
  getChangeEvent,
  getCommitment,
  getPayApp,
  getProcurementOverview,
  getRegisterOrder,
  getWorkflowInstance,
  listChangeEvents,
  listChangeOrders,
  listCommitments,
  listLeadTimeAlerts,
  listLongLead,
  listMySteps,
  listPayApps,
  listRegisterOrders,
  respondToStep,
  submitPayApp,
  type ChangeEventFilters,
} from '@/api/commercial-endpoints'
import type { ChangeEvent, ChangeEventCreate, PayApp, WorkflowInstance } from '@/api/commercial-types'
import { keys } from '@/api/query'

const scoped = (projectId: string, ...rest: readonly unknown[]) => keys.projectScoped(projectId, ...rest)
export const MY_STEPS_KEY = ['workflow', 'my-steps'] as const

// ── Change events ──

export function useChangeEvents(projectId: string | null, filters: ChangeEventFilters = {}) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'change-events', filters), queryFn: ({ signal }) => listChangeEvents(projectId!, filters, signal), enabled: !!projectId, placeholderData: (previous) => previous })
}

export function useChangeEvent(projectId: string | null, changeEventId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'change-event', changeEventId), queryFn: ({ signal }) => getChangeEvent(projectId!, changeEventId!, signal), enabled: !!projectId && !!changeEventId })
}

export function useChangeEventActions(projectId: string) {
  const client = useQueryClient()
  const create = useMutation({
    mutationFn: (body: ChangeEventCreate) => createChangeEvent(projectId, body),
    onSuccess: (event: ChangeEvent) => {
      client.setQueryData(scoped(projectId, 'change-event', event.id), event)
      void client.invalidateQueries({ queryKey: scoped(projectId, 'change-events') })
    },
  })
  return { create }
}

// ── Change orders, commitments, pay applications ──

export function useChangeOrders(projectId: string | null, status?: string) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'change-orders', status ?? 'all'), queryFn: ({ signal }) => listChangeOrders(projectId!, status, signal), enabled: !!projectId, placeholderData: (previous) => previous })
}

export function useCommitments(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'commitments'), queryFn: ({ signal }) => listCommitments(projectId!, signal), enabled: !!projectId })
}

export function useCommitment(projectId: string | null, commitmentId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'commitment', commitmentId), queryFn: ({ signal }) => getCommitment(projectId!, commitmentId!, signal), enabled: !!projectId && !!commitmentId })
}

export function usePayApps(projectId: string | null, status?: string) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'pay-apps', status ?? 'all'), queryFn: ({ signal }) => listPayApps(projectId!, status, signal), enabled: !!projectId, placeholderData: (previous) => previous })
}

export function usePayApp(projectId: string | null, payAppId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'pay-app', payAppId), queryFn: ({ signal }) => getPayApp(projectId!, payAppId!, signal), enabled: !!projectId && !!payAppId })
}

export function usePayAppActions(projectId: string) {
  const client = useQueryClient()
  const submit = useMutation({
    mutationFn: (payAppId: string) => submitPayApp(projectId, payAppId),
    onSuccess: (payApp: PayApp) => {
      client.setQueryData(scoped(projectId, 'pay-app', payApp.id), payApp)
      void client.invalidateQueries({ queryKey: scoped(projectId, 'pay-apps') })
      void client.invalidateQueries({ queryKey: keys.needsYou(projectId) })
    },
  })
  return { submit }
}

// ── Workflow inbox ──

export function useMySteps() {
  // Kept for half a minute so moving between screens does not refetch, but
  // always refreshed on the way in: this is the screen a person opens to ask
  // what is waiting on them, and an answer half a minute out of date can be
  // missing the approval they were told about and came here to give.
  return useQuery({ queryKey: MY_STEPS_KEY, queryFn: ({ signal }) => listMySteps(signal), staleTime: 30_000, refetchOnMount: 'always' })
}

export function useWorkflowInstance(projectId: string | null, instanceId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'workflow-instance', instanceId), queryFn: ({ signal }) => getWorkflowInstance(projectId!, instanceId!, signal), enabled: !!projectId && !!instanceId })
}

export function useWorkflowActions(projectId: string) {
  const client = useQueryClient()
  const respond = useMutation({
    mutationFn: ({ instanceId, response, comment }: { instanceId: string; response: string; comment?: string }) => respondToStep(projectId, instanceId, { response, comment }),
    onSuccess: (instance: WorkflowInstance) => {
      client.setQueryData(scoped(projectId, 'workflow-instance', instance.id), instance)
      void client.invalidateQueries({ queryKey: MY_STEPS_KEY })
      void client.invalidateQueries({ queryKey: keys.needsYou(projectId) })
      // The record the workflow moved is one of these; refresh whichever is cached.
      for (const key of ['change-orders', 'commitments', 'commitment', 'pay-apps', 'pay-app']) void client.invalidateQueries({ queryKey: scoped(projectId, key) })
    },
  })
  return { respond }
}

// ── Procurement ──

export function useProcurementOverview(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'procurement', 'overview'), queryFn: ({ signal }) => getProcurementOverview(projectId!, signal), enabled: !!projectId })
}

export function useLeadTimeAlerts(projectId: string | null, status?: string) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'procurement', 'alerts', status ?? 'all'), queryFn: ({ signal }) => listLeadTimeAlerts(projectId!, status, signal), enabled: !!projectId, placeholderData: (previous) => previous })
}

export function useAlertActions(projectId: string) {
  const client = useQueryClient()
  const acknowledge = useMutation({
    mutationFn: (alertId: string) => acknowledgeAlert(projectId, alertId),
    onSuccess: () => void client.invalidateQueries({ queryKey: scoped(projectId, 'procurement') }),
  })
  return { acknowledge }
}

export function useRegisterOrders(projectId: string | null, status?: string) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'procurement', 'orders', status ?? 'all'), queryFn: ({ signal }) => listRegisterOrders(projectId!, status, signal), enabled: !!projectId, placeholderData: (previous) => previous })
}

export function useRegisterOrder(projectId: string | null, orderId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'procurement', 'order', orderId), queryFn: ({ signal }) => getRegisterOrder(projectId!, orderId!, signal), enabled: !!projectId && !!orderId })
}

export function useLongLead(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'procurement', 'long-lead'), queryFn: ({ signal }) => listLongLead(projectId!, signal), enabled: !!projectId })
}
