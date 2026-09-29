import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/** Report builder & portfolio (OCTA-RPT-BUILDER-023). */

export type ReportColumnType =
  | 'string'
  | 'number'
  | 'money'
  | 'date'
  | 'boolean'
  | 'enum'
export const REPORT_OPERATORS = [
  'eq',
  'neq',
  'in',
  'nin',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'empty',
  'not_empty',
  'is_true',
  'is_false',
  'last_days',
  'next_days',
  'before_today',
  'after_today',
  'today',
] as const
export type ReportOperator = (typeof REPORT_OPERATORS)[number]
export const OPERATOR_LABEL: Record<ReportOperator, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is any of',
  nin: 'is none of',
  contains: 'contains',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  between: 'between',
  empty: 'is empty',
  not_empty: 'is not empty',
  is_true: 'is yes',
  is_false: 'is no',
  last_days: 'in the last N days',
  next_days: 'in the next N days',
  before_today: 'before today',
  after_today: 'after today',
  today: 'today',
}
export const OPERATORS_BY_TYPE: Record<ReportColumnType, ReportOperator[]> = {
  string: ['contains', 'eq', 'neq', 'in', 'nin', 'empty', 'not_empty'],
  enum: ['eq', 'neq', 'in', 'nin', 'empty', 'not_empty'],
  number: [
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'between',
    'empty',
    'not_empty',
  ],
  money: [
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'between',
    'empty',
    'not_empty',
  ],
  date: [
    'last_days',
    'next_days',
    'before_today',
    'after_today',
    'today',
    'gt',
    'gte',
    'lt',
    'lte',
    'between',
    'empty',
    'not_empty',
  ],
  boolean: ['is_true', 'is_false'],
}
export const NO_VALUE_OPERATORS: ReportOperator[] = [
  'empty',
  'not_empty',
  'is_true',
  'is_false',
  'before_today',
  'after_today',
  'today',
]
export const AGGREGATE_FNS = ['count', 'sum', 'avg', 'min', 'max'] as const
export type AggregateFn = (typeof AGGREGATE_FNS)[number]

export interface ReportColumn {
  key: string
  label: string
  type: ReportColumnType
  computed: boolean
  enum: string[] | null
}

export interface ReportSource {
  key: string
  label: string
  module: string
  defaultColumns: string[]
  defaultSort: { field: string; dir: 'asc' | 'desc' } | null
  columns: ReportColumn[]
}

export interface ReportFilter {
  field: string
  op: ReportOperator
  value?: unknown
}

export interface ReportAggregate {
  fn: AggregateFn
  field?: string | null
}

export interface ReportChart {
  type: 'bar' | 'line' | 'pie' | 'none'
  metric: string
}

export interface ReportDefinitionInput {
  name: string
  description?: string | null
  source: string
  projectId?: string | null
  columns: string[]
  filters: ReportFilter[]
  sort?: { field: string; dir: 'asc' | 'desc' } | null
  groupBy?: string | null
  aggregates: ReportAggregate[]
  chart?: ReportChart | null
  visibility: 'private' | 'project' | 'org'
}

export interface ReportDefinition extends ReportDefinitionInput {
  id: string
  project: { id: string; name: string } | null
  sourceLabel: string
  createdBy: string | null
  isOwner: boolean
  scheduleCount: number
  lastRunAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type ReportRow = Record<string, unknown> & {
  id: string
  projectId: string | null
  projectName: string | null
  /** Columns the server withheld on this row's project (null in the row). */
  withheldColumns?: string[]
}

export interface ReportResult {
  source: { key: string; label: string; module: string }
  columns: Array<{
    key: string
    label: string
    type: ReportColumnType
    withheld?: boolean
    withheldReason?: string
  }>
  /** Present only when a column this run uses was withheld on some project (E1). */
  withheld?: { columns: string[]; reason: string; projects: number }
  rows: ReportRow[]
  rowCount: number
  total: number
  truncated: boolean
  groupBy: { key: string; label: string; type: ReportColumnType } | null
  aggregates: Array<{
    fn: AggregateFn
    field: string | null
    key: string
    label: string
  }>
  groups: Array<
    Record<string, unknown> & { key: string; label: string; count: number }
  > | null
  totals: Record<string, number | string | null>
  projects: { inScope: number; queried: number; denied: number }
  generatedAt: string
  report?: ReportDefinition
}

export interface ReportSchedule {
  id: string
  reportId: string
  frequency: 'daily' | 'weekly' | 'monthly'
  dayOfWeek: number
  dayOfMonth: number
  hour: number
  minute: number
  timezone: string
  format: 'pdf' | 'xlsx' | 'both'
  recipients: { userIds: string[]; roles: string[]; emails: string[] }
  enabled: boolean
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  createdBy: string | null
}

export interface ReportRun {
  id: string
  reportId: string
  scheduleId: string | null
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  trigger: 'manual' | 'schedule'
  format: string
  rowCount: number
  truncated: boolean
  hasPdf: boolean
  hasXlsx: boolean
  fileBase: string | null
  recipients: { userIds: string[]; roles: string[]; emails: string[] } | null
  delivery: {
    notified: number
    emails: string[]
    failedEmails: Array<{ email: string; error: string }>
    at: string
  } | null
  error: string | null
  requestedBy: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string | null
}

export interface PortfolioSnapshot {
  overallScore: number | null
  dimensions: Record<string, number>
  weakestDimension: string | null
  spi: number | null
  cpi: number | null
  ev: number | null
  pv: number | null
  ac: number | null
  eac: number | null
  bac: number | null
  cashIn90: number | null
  cashOut90: number | null
  cashNet90: number | null
  cashNetToDate: number | null
  openRfis: number
  overdueRfis: number
  openPunch: number
  openNcrs: number
  pendingSubmittals: number
  openTasks: number
  overdueTasks: number
  pendingChangeOrders: number
  delayedActivities: number
  criticalActivities: number
  procurementRisks: number
  overdueItems: number
  openItems: number
  computedAt: string | null
  stale: boolean
}

export interface PortfolioRow {
  id: string
  name: string
  status: string
  currency: string
  client: string | null
  contractValue: number
  startDate: string | null
  endDate: string | null
  snapshot: PortfolioSnapshot | null
  stale: boolean
  path: string
}

export interface Portfolio {
  generatedAt: string
  computedAt: string | null
  refreshing: boolean
  summary: {
    projects: number
    active: number
    contractValue: number
    averageHealth: number | null
    atRisk: number
    spiWatch: number
    cpiWatch: number
    openItems: number
    overdueItems: number
    cashNet90: number
    staleCount: number
  }
  rows: PortfolioRow[]
}

const key = ['reports'] as const
const unwrap = <T>(response: { data: { data: T } }) => response.data.data

const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: key })
}

export const useReportSources = () =>
  useQuery<ReportSource[]>({
    queryKey: [...key, 'sources'],
    queryFn: () =>
      apiClient
        .get('/reports/sources')
        .then(
          (response) => unwrap<{ sources: ReportSource[] }>(response).sources
        ),
    staleTime: 10 * 60 * 1000,
  })

export const useReports = (
  params: { projectId?: string | null; source?: string | null } = {}
) =>
  useQuery<{ items: ReportDefinition[]; sources: ReportSource[] }>({
    queryKey: [...key, 'list', params],
    queryFn: () =>
      apiClient
        .get('/reports', {
          params: Object.fromEntries(
            Object.entries(params).filter(([, value]) => value)
          ),
        })
        .then((response) =>
          unwrap<{ items: ReportDefinition[]; sources: ReportSource[] }>(
            response
          )
        ),
  })

export const useReport = (reportId: string | null) =>
  useQuery<ReportDefinition>({
    queryKey: [...key, 'one', reportId ?? ''],
    queryFn: () =>
      apiClient
        .get(`/reports/${reportId}`)
        .then((response) => unwrap<ReportDefinition>(response)),
    enabled: Boolean(reportId),
  })

export const useCreateReport = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ReportDefinitionInput) =>
      apiClient.post('/reports', payload).then(unwrap<ReportDefinition>),
    onSuccess: () => invalidate(qc),
  })
}

export const useUpdateReport = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      reportId,
      payload,
    }: {
      reportId: string
      payload: Partial<ReportDefinitionInput>
    }) =>
      apiClient
        .put(`/reports/${reportId}`, payload)
        .then(unwrap<ReportDefinition>),
    onSuccess: () => invalidate(qc),
  })
}

export const useDeleteReport = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (reportId: string) =>
      apiClient
        .delete(`/reports/${reportId}`)
        .then(unwrap<{ deleted: boolean }>),
    onSuccess: () => invalidate(qc),
  })
}

export const usePreviewReport = () =>
  useMutation({
    mutationFn: (
      payload: Omit<ReportDefinitionInput, 'name' | 'visibility'> & {
        limit?: number
        offset?: number
      }
    ) => apiClient.post('/reports/preview', payload).then(unwrap<ReportResult>),
  })

export const useRunReport = () =>
  useMutation({
    mutationFn: ({
      reportId,
      limit,
      offset,
    }: {
      reportId: string
      limit?: number
      offset?: number
    }) =>
      apiClient
        .post(`/reports/${reportId}/run`, { limit, offset })
        .then(unwrap<ReportResult>),
  })

export const useReportRuns = (reportId: string | null) =>
  useQuery<ReportRun[]>({
    queryKey: [...key, 'runs', reportId ?? ''],
    queryFn: () =>
      apiClient
        .get(`/reports/${reportId}/runs`)
        .then((response) => unwrap<{ items: ReportRun[] }>(response).items),
    enabled: Boolean(reportId),
  })

export const useCreateReportRun = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      reportId,
      format,
      deliver,
      recipients,
    }: {
      reportId: string
      format: 'pdf' | 'xlsx' | 'both'
      deliver?: boolean
      recipients?: { userIds?: string[]; roles?: string[]; emails?: string[] }
    }) =>
      apiClient
        .post(
          `/reports/${reportId}/runs`,
          { format, deliver, recipients },
          { timeout: 180_000 }
        )
        .then(unwrap<ReportRun>),
    onSuccess: () => invalidate(qc),
  })
}

export const useReportSchedules = (reportId: string | null) =>
  useQuery<ReportSchedule[]>({
    queryKey: [...key, 'schedules', reportId ?? ''],
    queryFn: () =>
      apiClient
        .get(`/reports/${reportId}/schedules`)
        .then(
          (response) => unwrap<{ items: ReportSchedule[] }>(response).items
        ),
    enabled: Boolean(reportId),
  })

export type ReportScheduleInput = Partial<
  Pick<
    ReportSchedule,
    | 'frequency'
    | 'dayOfWeek'
    | 'dayOfMonth'
    | 'hour'
    | 'minute'
    | 'timezone'
    | 'format'
    | 'recipients'
    | 'enabled'
  >
>

export const useSaveReportSchedule = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      reportId,
      scheduleId,
      payload,
    }: {
      reportId: string
      scheduleId?: string | null
      payload: ReportScheduleInput
    }) =>
      (scheduleId
        ? apiClient.patch(
            `/reports/${reportId}/schedules/${scheduleId}`,
            payload
          )
        : apiClient.post(`/reports/${reportId}/schedules`, payload)
      ).then(unwrap<ReportSchedule>),
    onSuccess: () => invalidate(qc),
  })
}

export const useDeleteReportSchedule = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      reportId,
      scheduleId,
    }: {
      reportId: string
      scheduleId: string
    }) =>
      apiClient
        .delete(`/reports/${reportId}/schedules/${scheduleId}`)
        .then(unwrap<{ deleted: boolean }>),
    onSuccess: () => invalidate(qc),
  })
}

const saveBlob = (data: Blob, fileName: string) => {
  const url = URL.createObjectURL(data)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

const fileNameFrom = (
  headers: Record<string, unknown> | undefined,
  fallback: string
) => {
  const disposition = String(headers?.['content-disposition'] ?? '')
  const match = /filename="?([^";]+)"?/.exec(disposition)
  return match?.[1] ?? fallback
}

export const downloadReportExport = async (
  reportId: string,
  format: 'pdf' | 'xlsx'
) => {
  const response = await apiClient.get(
    `/reports/${reportId}/export.${format}`,
    { responseType: 'blob', timeout: 180_000 }
  )
  saveBlob(
    new Blob([response.data]),
    fileNameFrom(
      response.headers as Record<string, unknown>,
      `report.${format}`
    )
  )
}

/** Renders an unsaved definition — the "export this view" behind registers and the builder. */
export const downloadDefinitionExport = async (
  definition: Omit<ReportDefinitionInput, 'visibility'> & { name?: string },
  format: 'pdf' | 'xlsx'
) => {
  const response = await apiClient.post(
    '/reports/export',
    { ...definition, format },
    { responseType: 'blob', timeout: 180_000 }
  )
  saveBlob(
    new Blob([response.data]),
    fileNameFrom(
      response.headers as Record<string, unknown>,
      `report.${format}`
    )
  )
}

export const downloadRunFile = async (
  runId: string,
  format: 'pdf' | 'xlsx'
) => {
  const response = await apiClient.get(`/reports/runs/${runId}/download`, {
    params: { format },
    responseType: 'blob',
    timeout: 120_000,
  })
  saveBlob(
    new Blob([response.data]),
    fileNameFrom(
      response.headers as Record<string, unknown>,
      `report.${format}`
    )
  )
}

/** Polls every 5 s while a snapshot refresh job is running. */
export const usePortfolio = () =>
  useQuery<Portfolio>({
    queryKey: ['portfolio'],
    queryFn: () =>
      apiClient
        .get('/portfolio')
        .then((response) => unwrap<Portfolio>(response)),
    refetchInterval: (query) => (query.state.data?.refreshing ? 5000 : false),
  })

export const useRefreshPortfolio = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiClient
        .post('/portfolio/refresh')
        .then(unwrap<{ jobId: string; status: string; queued: boolean }>),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portfolio'] }),
  })
}

export const downloadPortfolioXlsx = async () => {
  const response = await apiClient.get('/portfolio/export.xlsx', {
    responseType: 'blob',
    timeout: 120_000,
  })
  saveBlob(
    new Blob([response.data]),
    fileNameFrom(response.headers as Record<string, unknown>, 'portfolio.xlsx')
  )
}
