import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export type AuditEntityType =
  | 'schedule_revision'
  | 'progress_submission'
  | 'daily_report'
  | 'site_diary'
  | 'ipc_certificate'
  | 'ipc_item'
  | 'change_order'
  | 'sub_valuation'
  | 'eot_claim'
  | 'weather_delay'
  | 'boq_item'
  | 'boq_revision'
  | 'cost_record'
  | 'burn_rate_entry'
  | 'rfi'
  | 'submittal'

export interface AuditEvent {
  id: string
  orgId: string
  projectId: string
  entityType: AuditEntityType | string
  entityId: string
  action: string
  actorId: string | null
  actorRole: string | null
  occurredAt: string
  oldStatus: string | null
  newStatus: string | null
  reason: string | null
  oldSummary: Record<string, unknown> | null
  newSummary: Record<string, unknown> | null
  summary: Record<string, unknown>
  attachments: Array<Record<string, unknown>>
  metadata: Record<string, unknown>
  createdAt: string
}

export interface AuditEventsResponse {
  events: AuditEvent[]
  nextCursor: string | null
}

export interface AuditEventFilters {
  entityType?: AuditEntityType | string | null
  entityId?: string | null
  action?: string | null
  limit?: number
  order?: 'asc' | 'desc'
}

export const auditEventsKey = (
  projectId: string,
  filters: AuditEventFilters = {}
) => ['audit-events', projectId, filters]

export function useAuditEvents(
  projectId: string,
  filters: AuditEventFilters = {}
) {
  return useQuery<AuditEventsResponse>({
    queryKey: auditEventsKey(projectId, filters),
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/audit`, {
          params: {
            entityType: filters.entityType || undefined,
            entityId: filters.entityId || undefined,
            action: filters.action || undefined,
            limit: filters.limit || 20,
            order: filters.order || 'desc',
          },
        })
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })
}
