import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { newClientRequestId, type QueuedResult } from '@/lib/offline/outbox'
import { sendOrQueue } from '@/lib/offline/queue-request'

/** Project daily log (OCTA-FLD-DAILY-022). */

export const DAILY_LOG_SECTIONS = [
  'manpower',
  'equipment',
  'deliveries',
  'visitors',
  'delays',
  'notes',
] as const
export type DailyLogSection = (typeof DAILY_LOG_SECTIONS)[number]
export type DailyLogStatus = 'open' | 'submitted' | 'approved'
export type DailyLogEntryStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
export const DELAY_TYPES = [
  'weather',
  'access',
  'design',
  'material',
  'labour',
  'equipment',
  'inspection',
  'utility',
  'other',
] as const
export type DelayType = (typeof DELAY_TYPES)[number]
export const NOTE_KINDS = [
  'general',
  'safety',
  'instruction',
  'inspection',
  'issue',
] as const
export type NoteKind = (typeof NOTE_KINDS)[number]

export const SECTION_LABEL: Record<DailyLogSection, string> = {
  manpower: 'Manpower',
  equipment: 'Equipment',
  deliveries: 'Deliveries',
  visitors: 'Visitors',
  delays: 'Delays',
  notes: 'Notes',
}

export interface WeatherAlert {
  metric: 'rain' | 'cold' | 'heat' | 'wind'
  value: number
  threshold: number
  message: string
}

export interface DailyLogWeather {
  source: string | null
  date?: string | null
  code?: number | null
  condition: string | null
  tempMinC: number | null
  tempMaxC: number | null
  precipitationMm: number | null
  windMaxKph: number | null
  windGustKph?: number | null
  summary: string | null
  notes?: string | null
  alerts?: WeatherAlert[]
}

export interface DailyLogEntry {
  id: string
  section: DailyLogSection
  dailyLogId: string
  partyId: string | null
  party: {
    id: string
    role: string
    companyId: string | null
    companyName: string | null
  } | null
  status: DailyLogEntryStatus
  createdBy: string | null
  submittedAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  rejectionReason: string | null
  clientRequestId: string | null
  sortOrder: number
  companyId?: string | null
  companyName?: string | null
  trade?: string | null
  workers?: number | null
  hours?: number | null
  manHours?: number | null
  equipmentId?: string | null
  equipment?: { id: string; name: string; rateType: string | null } | null
  name?: string | null
  count?: number | null
  hoursOperated?: number | null
  hoursIdle?: number | null
  supplierName?: string | null
  description?: string | null
  quantity?: number | null
  unit?: string | null
  poRef?: string | null
  receivedBy?: string | null
  deliveredAt?: string | null
  company?: string | null
  purpose?: string | null
  arrivedAt?: string | null
  leftAt?: string | null
  type?: DelayType | null
  hoursLost?: number | null
  source?: 'manual' | 'weather_feed' | null
  weatherDelayId?: string | null
  suggested?: boolean
  kind?: NoteKind | null
  text?: string | null
  activityId?: string | null
  activity?: { id: string; name: string; code: string | null } | null
  locationId?: string | null
  location?: { id: string; name: string; code: string | null } | null
  notes?: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface DailyLogTotals {
  workers: number
  manHours: number
  companies: number
  equipmentCount: number
  equipmentHours: number
  idleHours: number
  deliveries: number
  visitors: number
  hoursLost: number
  notes: number
  entries: number
  awaitingReview: number
  suggestedDelays: number
}

export interface DailyLogDistribution {
  at: string
  by: string | null
  scheduled: boolean
  roles: string[]
  userIds: string[]
  emails: string[]
  failedEmails: Array<{ email: string; error: string }>
  notified: number
  documentId: string | null
  fileName: string | null
}

export interface DailyLog {
  id: string | null
  exists: boolean
  projectId: string
  date: string
  status: DailyLogStatus
  weather: DailyLogWeather | null
  weatherSource: 'feed' | 'manual' | null
  weatherFetchedAt: string | null
  summary: string | null
  submittedAt: string | null
  submittedBy: string | null
  approvedAt: string | null
  approvedBy: string | null
  distributedAt: string | null
  distribution: DailyLogDistribution | null
  pdfDocumentId: string | null
  sections: Record<DailyLogSection, DailyLogEntry[]>
  totals: DailyLogTotals
  path: string
  entryId?: string | null
  replayed?: boolean
  copy?: {
    fromDate: string
    copied: Partial<Record<DailyLogSection, number>>
    skipped: Partial<Record<DailyLogSection, string>>
  }
  alerts?: WeatherAlert[]
  weatherSkipped?: boolean
  weatherDelay?: { id: string; delayDays: number; contractual: boolean }
  document?: { id: string; fileName: string }
  createdAt: string | null
  updatedAt: string | null
}

export interface DailyLogListItem {
  id: string
  date: string
  status: DailyLogStatus
  weather: {
    condition: string | null
    summary: string | null
    tempMaxC: number | null
    precipitationMm: number | null
    alerts: WeatherAlert[]
  } | null
  weatherSource: 'feed' | 'manual' | null
  totals: DailyLogTotals
  distributedAt: string | null
}

export interface DailyLogSettings {
  projectId: string
  latitude: number | null
  longitude: number | null
  timezone: string | null
  weatherFeedAvailable: boolean
  hasCoordinates: boolean
  weatherFeedEnabled: boolean
  thresholds: {
    rainMm: number | null
    tempMinC: number | null
    tempMaxC: number | null
    windKph: number | null
  }
  distributionRoles: string[]
  distributionRoleOptions: string[]
  distributionEmails: string[]
  autoDistributeAt: string | null
  copySections: DailyLogSection[]
}

export type DailyLogSettingsInput = Partial<
  Omit<
    DailyLogSettings,
    | 'projectId'
    | 'weatherFeedAvailable'
    | 'hasCoordinates'
    | 'distributionRoleOptions'
    | 'thresholds'
  >
> & {
  thresholds?: Partial<DailyLogSettings['thresholds']>
}

export interface ManpowerReport {
  from: string
  to: string
  groupBy: 'company' | 'trade' | 'company_trade' | 'activity'
  items: Array<{
    key: string
    label: string
    companyId: string | null
    companyName: string
    trade: string | null
    activityId: string | null
    workers: number
    manHours: number
    days: number
    entries: number
    avgWorkersPerDay: number
  }>
  byDate: Array<{ date: string; workers: number; manHours: number }>
  totals: { workers: number; manHours: number; entries: number; days: number }
}

export type DailyLogEntryInput = Record<string, unknown> & {
  clientRequestId?: string
}

const key = (projectId: string) => ['daily-log', projectId] as const
const base = (projectId: string) => `/projects/${projectId}/daily-logs`
const unwrap = <T>(data: unknown) => (data as { data: T }).data

const invalidate = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: key(projectId) })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
  qc.invalidateQueries({ queryKey: ['weather-delays', projectId] })
}

export const useDailyLog = (projectId: string, date: string) =>
  useQuery<DailyLog>({
    queryKey: [...key(projectId), 'day', date],
    queryFn: () =>
      apiClient
        .get(`${base(projectId)}/${date}`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId && date),
  })

export const useDailyLogs = (
  projectId: string,
  range: { from?: string; to?: string } = {}
) =>
  useQuery<{ from: string; to: string; items: DailyLogListItem[] }>({
    queryKey: [...key(projectId), 'list', range],
    queryFn: () =>
      apiClient
        .get(base(projectId), { params: range })
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useDailyLogSettings = (projectId: string) =>
  useQuery<DailyLogSettings>({
    queryKey: [...key(projectId), 'settings'],
    queryFn: () =>
      apiClient
        .get(`${base(projectId)}/settings`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
  })

export const useUpdateDailyLogSettings = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: DailyLogSettingsInput) =>
      apiClient
        .put(`${base(projectId)}/settings`, payload)
        .then((response) => response.data.data as DailyLogSettings),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useManpowerReport = (
  projectId: string,
  params: { from?: string; to?: string; groupBy?: ManpowerReport['groupBy'] },
  options: { enabled?: boolean } = {}
) =>
  useQuery<ManpowerReport>({
    queryKey: [...key(projectId), 'manpower-report', params],
    queryFn: () =>
      apiClient
        .get(`${base(projectId)}/manpower-report`, { params })
        .then((response) => response.data.data),
    enabled: Boolean(projectId) && (options.enabled ?? true),
  })

/** Adds an entry; goes to the outbox when offline (server replays by clientRequestId). */
export const useAddDailyLogEntry = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      date,
      section,
      payload,
    }: {
      date: string
      section: DailyLogSection
      payload: DailyLogEntryInput
    }): Promise<DailyLog | QueuedResult> => {
      const clientRequestId =
        payload.clientRequestId ?? newClientRequestId(`daily-log-${section}`)
      return sendOrQueue<DailyLog>({
        projectId,
        kind: 'daily_log',
        label: `Daily log ${date}: ${SECTION_LABEL[section].toLowerCase()}`,
        method: 'POST',
        url: `${base(projectId)}/${date}/entries/${section}`,
        body: { ...payload, clientRequestId },
        clientRequestId,
        parse: unwrap<DailyLog>,
      })
    },
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useUpdateDailyLogEntry = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      date,
      section,
      entryId,
      payload,
    }: {
      date: string
      section: DailyLogSection
      entryId: string
      payload: DailyLogEntryInput
    }) =>
      apiClient
        .patch(
          `${base(projectId)}/${date}/entries/${section}/${entryId}`,
          payload
        )
        .then((response) => response.data.data as DailyLog),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useDeleteDailyLogEntry = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      date,
      section,
      entryId,
    }: {
      date: string
      section: DailyLogSection
      entryId: string
    }) =>
      apiClient
        .delete(`${base(projectId)}/${date}/entries/${section}/${entryId}`)
        .then((response) => response.data.data as DailyLog),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useReviewDailyLogEntry = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      date,
      section,
      entryId,
      decision,
      reason,
    }: {
      date: string
      section: DailyLogSection
      entryId: string
      decision: 'approve' | 'reject'
      reason?: string | null
    }) =>
      apiClient
        .post(
          `${base(projectId)}/${date}/entries/${section}/${entryId}/review`,
          { decision, reason: reason ?? null }
        )
        .then((response) => response.data.data as DailyLog),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useUpdateDailyLog = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      date,
      payload,
    }: {
      date: string
      payload: {
        summary?: string | null
        weather?: Partial<DailyLogWeather> | null
      }
    }) =>
      apiClient
        .patch(`${base(projectId)}/${date}`, payload)
        .then((response) => response.data.data as DailyLog),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useRefreshDailyLogWeather = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: string) =>
      apiClient
        .post(`${base(projectId)}/${date}/weather/refresh`)
        .then((response) => response.data.data as DailyLog),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useCopyPreviousDay = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      date,
      sections,
    }: {
      date: string
      sections?: DailyLogSection[]
    }) =>
      apiClient
        .post(
          `${base(projectId)}/${date}/copy-previous`,
          sections ? { sections } : {}
        )
        .then((response) => response.data.data as DailyLog),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export type DailyLogAction = 'submit' | 'approve' | 'reopen'

export const useDailyLogAction = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      date,
      action,
      reason,
    }: {
      date: string
      action: DailyLogAction
      reason?: string | null
    }) =>
      apiClient
        .post(`${base(projectId)}/${date}/${action}`, reason ? { reason } : {})
        .then((response) => response.data.data as DailyLog),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useDistributeDailyLog = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      date,
      roles,
      emails,
      note,
    }: {
      date: string
      roles?: string[]
      emails?: string[]
      note?: string | null
    }) =>
      apiClient
        .post(`${base(projectId)}/${date}/distribute`, {
          ...(roles ? { roles } : {}),
          ...(emails ? { emails } : {}),
          note: note ?? null,
        })
        .then((response) => response.data.data as DailyLog),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useLogWeatherDelay = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      date,
      entryId,
      delayDays,
      contractual,
    }: {
      date: string
      entryId: string
      delayDays?: number | null
      contractual?: boolean
    }) =>
      apiClient
        .post(
          `${base(projectId)}/${date}/entries/delays/${entryId}/weather-delay`,
          { delayDays: delayDays ?? null, contractual: contractual ?? true }
        )
        .then((response) => response.data.data as DailyLog),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const downloadDailyLogPdf = async (projectId: string, date: string) => {
  const response = await apiClient.get(
    `${base(projectId)}/${date}/export.pdf`,
    { responseType: 'blob', timeout: 120_000 }
  )
  const disposition = String(response.headers?.['content-disposition'] ?? '')
  const match = /filename="?([^";]+)"?/.exec(disposition)
  const url = URL.createObjectURL(
    new Blob([response.data], { type: 'application/pdf' })
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = match?.[1] ?? `daily-log-${date}.pdf`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export const todayKey = () => new Date().toISOString().slice(0, 10)
export const shiftDate = (date: string, days: number) => {
  const next = new Date(`${date}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}
