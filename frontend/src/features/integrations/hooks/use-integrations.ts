import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Integrations (OCTA-INT-API-026): API keys, webhooks and accounting
 * connectors, all managed under Company › Integrations; the project-side
 * hooks post pay applications to accounting and export costs.
 */

// ─── API keys ──────────────────────────────────────────────────────────────

export interface ApiScope {
  scope: string
  module: string
  access: 'read' | 'write'
  label: string
}

export interface ApiClientRecord {
  id: string
  name: string
  description: string | null
  keyPrefix: string
  scopes: string[]
  projectIds: string[]
  status: 'active' | 'revoked'
  owner: {
    id: string
    name?: string | null
    email?: string | null
    role?: string | null
  }
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string | null
  updatedAt: string | null
  token?: string | null
}

export interface ApiClientInput {
  name?: string
  description?: string | null
  scopes?: string[]
  projectIds?: string[]
  userId?: string | null
  expiresAt?: string | null
  status?: 'revoked'
}

// ─── Webhooks ──────────────────────────────────────────────────────────────

export type WebhookStatus = 'active' | 'paused' | 'disabled'
export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'dead'

export interface WebhookRecord {
  id: string
  projectId: string | null
  project: { id: string; name: string } | null
  name: string
  description: string | null
  url: string
  secret: string | null
  secretHint: string | null
  eventTypes: string[]
  status: WebhookStatus
  failureCount: number
  lastDeliveryAt: string | null
  lastStatus: string | null
  lastError: string | null
  deliveryCount: number | null
  createdAt: string | null
  updatedAt: string | null
}

export interface WebhookInput {
  name?: string
  url?: string
  eventTypes?: string[]
  description?: string | null
  projectId?: string | null
  secret?: string | null
  status?: 'active' | 'paused'
}

export interface WebhookDelivery {
  id: string
  subscriptionId: string
  eventId: string
  eventType: string
  attempt: number
  maxAttempts: number
  status: DeliveryStatus
  responseStatus: number | null
  responseBody: string | null
  error: string | null
  durationMs: number | null
  nextAttemptAt: string | null
  deliveredAt: string | null
  payload: Record<string, unknown>
  createdAt: string | null
  updatedAt: string | null
}

// ─── Accounting ────────────────────────────────────────────────────────────

export type AccountingProvider = 'qbo' | 'xero'

export interface AccountingConnection {
  provider: AccountingProvider
  label: string
  configured: boolean
  encryptionReady: boolean
  status: 'pending' | 'connected' | 'disconnected' | 'error'
  externalOrgId: string | null
  externalOrgName: string | null
  autoSyncPayApps: boolean
  connectedBy: string | null
  connectedAt: string | null
  lastSyncAt: string | null
  lastError: string | null
}

export interface AccountingAccount {
  id: string
  code: string | null
  name: string
  type: string | null
}

export interface AccountingMapping {
  id: string
  provider: AccountingProvider
  costCode: string
  costCodeId: string | null
  externalAccountId: string | null
  externalAccountName: string | null
  updatedAt: string | null
}

export type SyncStatus = 'pending' | 'synced' | 'paid' | 'failed'

export interface AccountingSync {
  id: string
  projectId: string
  project: { id: string; name: string } | null
  provider: AccountingProvider
  providerLabel: string
  recordType: string
  recordId: string
  externalId: string | null
  externalRef: string | null
  externalVendorId: string | null
  status: SyncStatus
  amount: number
  currency: string | null
  attempts: number
  lastError: string | null
  syncedAt: string | null
  paidAt: string | null
  paidAmount: number | null
  requestedBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

export const SYNC_STATUS_LABEL: Record<SyncStatus, string> = {
  pending: 'Waiting to post',
  synced: 'Posted',
  paid: 'Paid',
  failed: 'Failed',
}

const rootKey = ['integrations'] as const
const invalidate = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: rootKey })

const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

export const useApiScopes = () =>
  useQuery<{ scopes: ApiScope[]; prefix: string }>({
    queryKey: [...rootKey, 'scopes'],
    queryFn: () => data(apiClient.get('/integrations/scopes')),
    staleTime: 10 * 60_000,
  })

export const useApiClients = (includeRevoked = false) =>
  useQuery<ApiClientRecord[]>({
    queryKey: [...rootKey, 'api-clients', includeRevoked],
    queryFn: () =>
      data<{ items: ApiClientRecord[] }>(
        apiClient.get('/integrations/api-clients', {
          params: includeRevoked ? { includeRevoked: true } : {},
        })
      ).then((result) => result.items),
  })

export const useCreateApiClient = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ApiClientInput) =>
      data<ApiClientRecord>(
        apiClient.post('/integrations/api-clients', payload)
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useUpdateApiClient = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ApiClientInput }) =>
      data<ApiClientRecord>(
        apiClient.patch(`/integrations/api-clients/${id}`, payload)
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useRevokeApiClient = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      data<ApiClientRecord>(
        apiClient.delete(`/integrations/api-clients/${id}`)
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useWebhookEventTypes = () =>
  useQuery<{
    eventTypes: Array<{ key: string; label: string }>
    signatureHeader: string
    maxAttempts: number
  }>({
    queryKey: [...rootKey, 'webhook-event-types'],
    queryFn: () => data(apiClient.get('/integrations/webhooks/event-types')),
    staleTime: 10 * 60_000,
  })

export const useWebhooks = () =>
  useQuery<WebhookRecord[]>({
    queryKey: [...rootKey, 'webhooks'],
    queryFn: () =>
      data<{ items: WebhookRecord[] }>(
        apiClient.get('/integrations/webhooks')
      ).then((result) => result.items),
  })

export const useSaveWebhook = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id?: string | null
      payload: WebhookInput
    }) =>
      data<WebhookRecord>(
        id
          ? apiClient.patch(`/integrations/webhooks/${id}`, payload)
          : apiClient.post('/integrations/webhooks', payload)
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useDeleteWebhook = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      data<{ deleted: boolean }>(
        apiClient.delete(`/integrations/webhooks/${id}`)
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useRotateWebhookSecret = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      data<WebhookRecord>(
        apiClient.post(`/integrations/webhooks/${id}/rotate-secret`, {})
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useTestWebhook = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      data<{ ok: boolean; error?: string | null; delivery: WebhookDelivery }>(
        apiClient.post(`/integrations/webhooks/${id}/test`, {})
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useWebhookDeliveries = (
  id: string | null,
  status: DeliveryStatus | 'all' = 'all'
) =>
  useQuery<WebhookDelivery[]>({
    queryKey: [...rootKey, 'webhook-deliveries', id ?? '', status],
    queryFn: () =>
      data<{ items: WebhookDelivery[] }>(
        apiClient.get(`/integrations/webhooks/${id}/deliveries`, {
          params: { limit: 100, ...(status !== 'all' ? { status } : {}) },
        })
      ).then((result) => result.items),
    enabled: Boolean(id),
    refetchInterval: 30_000,
  })

export const useRedeliverWebhook = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (deliveryId: string) =>
      data<WebhookDelivery>(
        apiClient.post(
          `/integrations/webhooks/deliveries/${deliveryId}/redeliver`,
          {}
        )
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useAccountingConnections = () =>
  useQuery<AccountingConnection[]>({
    queryKey: [...rootKey, 'accounting-connections'],
    queryFn: () =>
      data<{ items: AccountingConnection[] }>(
        apiClient.get('/integrations/accounting/connections')
      ).then((result) => result.items),
  })

export const useConnectAccounting = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (provider: AccountingProvider) =>
      data<{ provider: AccountingProvider; url: string }>(
        apiClient.post(`/integrations/accounting/${provider}/connect`, {})
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useUpdateAccountingConnection = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      provider,
      payload,
    }: {
      provider: AccountingProvider
      payload: { autoSyncPayApps?: boolean }
    }) =>
      data<AccountingConnection>(
        apiClient.patch(`/integrations/accounting/${provider}`, payload)
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useDisconnectAccounting = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (provider: AccountingProvider) =>
      data<AccountingConnection>(
        apiClient.delete(`/integrations/accounting/${provider}`)
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useAccountingAccounts = (
  provider: AccountingProvider | null,
  enabled: boolean
) =>
  useQuery<AccountingAccount[]>({
    queryKey: [...rootKey, 'accounting-accounts', provider ?? ''],
    queryFn: () =>
      data<{ items: AccountingAccount[] }>(
        apiClient.get(`/integrations/accounting/${provider}/accounts`)
      ).then((result) => result.items),
    enabled: Boolean(provider) && enabled,
    staleTime: 5 * 60_000,
  })

export const useAccountingMappings = (provider: AccountingProvider | null) =>
  useQuery<AccountingMapping[]>({
    queryKey: [...rootKey, 'accounting-mappings', provider ?? 'all'],
    queryFn: () =>
      data<{ items: AccountingMapping[] }>(
        apiClient.get('/integrations/accounting/mappings', {
          params: provider ? { provider } : {},
        })
      ).then((result) => result.items),
  })

export const useSaveAccountingMapping = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      provider: AccountingProvider
      costCode: string
      costCodeId?: string | null
      externalAccountId: string
      externalAccountName?: string | null
    }) =>
      data<AccountingMapping>(
        apiClient.put('/integrations/accounting/mappings', payload)
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useDeleteAccountingMapping = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      data<{ deleted: boolean }>(
        apiClient.delete(`/integrations/accounting/mappings/${id}`)
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useAccountingSyncs = (status: SyncStatus | 'all' = 'all') =>
  useQuery<AccountingSync[]>({
    queryKey: [...rootKey, 'accounting-syncs', status],
    queryFn: () =>
      data<{ items: AccountingSync[] }>(
        apiClient.get('/integrations/accounting/syncs', {
          params: status !== 'all' ? { status } : {},
        })
      ).then((result) => result.items),
    refetchInterval: 30_000,
  })

export const useRetryAccountingSync = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      data<AccountingSync>(
        apiClient.post(`/integrations/accounting/syncs/${id}/retry`, {})
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const usePollAccounting = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      data<{ checked: number; paid: number }>(
        apiClient.post('/integrations/accounting/poll', {})
      ),
    onSuccess: () => {
      invalidate(qc)
      qc.invalidateQueries({ queryKey: ['pay-apps'] })
    },
  })
}

// ─── project side ──────────────────────────────────────────────────────────

export const useProjectAccountingConnections = (projectId: string) =>
  useQuery<
    Array<{
      provider: AccountingProvider
      label: string
      status: string
      externalOrgName: string | null
      autoSyncPayApps: boolean
    }>
  >({
    queryKey: [...rootKey, 'project-connections', projectId],
    queryFn: () =>
      data<{ items: never[] }>(
        apiClient.get(`/projects/${projectId}/accounting/connections`)
      ).then((result) => result.items),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  })

export const useProjectAccountingSyncs = (
  projectId: string,
  recordId: string | null
) =>
  useQuery<AccountingSync[]>({
    queryKey: [...rootKey, 'project-syncs', projectId, recordId ?? ''],
    queryFn: () =>
      data<{ items: AccountingSync[] }>(
        apiClient.get(`/projects/${projectId}/accounting/syncs`, {
          params: recordId ? { recordId } : {},
        })
      ).then((result) => result.items),
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((item) => item.status === 'pending')
        ? 5_000
        : false,
  })

export const useSyncPayAppToAccounting = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      payAppId,
      provider,
    }: {
      payAppId: string
      provider?: AccountingProvider | null
    }) =>
      data<{ items: AccountingSync[] }>(
        apiClient.post(
          `/projects/${projectId}/accounting/pay-apps/${payAppId}/sync`,
          {},
          { params: provider ? { provider } : {} }
        )
      ).then((result) => result.items),
    onSuccess: () => invalidate(qc),
  })
}

export const useRetryProjectAccountingSync = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (syncId: string) =>
      data<AccountingSync>(
        apiClient.post(
          `/projects/${projectId}/accounting/syncs/${syncId}/retry`,
          {}
        )
      ),
    onSuccess: () => invalidate(qc),
  })
}

const saveBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

const fileNameFrom = (headers: Record<string, unknown>, fallback: string) => {
  const disposition = String(headers?.['content-disposition'] ?? '')
  const match = /filename="?([^";]+)"?/.exec(disposition)
  return match?.[1] ?? fallback
}

/** Downloads the accounting export (company-wide or for one project). */
export const downloadAccountingExport = async ({
  projectId = null,
  format = 'xlsx',
  provider = null,
  from = null,
  to = null,
}: {
  projectId?: string | null
  format?: 'xlsx' | 'csv'
  provider?: AccountingProvider | null
  from?: string | null
  to?: string | null
}) => {
  const response = await apiClient.get(
    projectId
      ? `/projects/${projectId}/accounting/export`
      : '/integrations/accounting/export',
    {
      params: {
        format,
        ...(provider ? { provider } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      },
      responseType: 'blob',
      timeout: 120_000,
    }
  )
  saveBlob(
    new Blob([response.data]),
    fileNameFrom(response.headers ?? {}, `accounting-export.${format}`)
  )
}
