import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export type AuditEntityType =
  | 'schedule_revision'
  | 'progress_submission'
  | 'daily_report'
  | 'site_diary'
  | 'ipc_certificate'
  | 'ipc_item'
  | 'activity_boq_allocation'
  | 'change_order'
  | 'sub_valuation'
  | 'eot_claim'
  | 'weather_delay'
  | 'boq_item'
  | 'boq_revision'
  | 'cost_record'
  | 'burn_rate_entry'
  | 'activity_equipment_usage'
  | 'document_revision'
  | 'ncr'
  | 'safety_incident'
  | 'rfi'
  | 'submittal'

export type AuditHistorySource =
  | 'all'
  | 'audit'
  | 'approval'
  | 'status'
  | 'comment'

export interface AuditEvent {
  id: string
  rawId?: string
  source?: Exclude<AuditHistorySource, 'all'>
  orgId: string
  projectId: string
  entityType: AuditEntityType | string
  entityId: string
  recordType?: AuditEntityType | string
  recordId?: string
  workflowType?: string | null
  action: string
  decision?: string | null
  actorId: string | null
  /** The person's name; null when they are no longer in the organisation (Phase 22A). */
  actorName?: string | null
  actorRole: string | null
  occurredAt: string
  oldStatus: string | null
  newStatus: string | null
  fromStatus?: string | null
  toStatus?: string | null
  reason: string | null
  comment?: string | null
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
  source?: AuditHistorySource | null
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
            source: filters.source || undefined,
            limit: filters.limit || 20,
            order: filters.order || 'desc',
          },
        })
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })
}
