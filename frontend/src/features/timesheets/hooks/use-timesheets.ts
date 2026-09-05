import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Timesheets and crews (OCTA-FLD-TIME-037): workers, crews, a day's
 * timesheet per crew with hours per worker per activity, the weekly grid,
 * productivity by activity and the XLSX export.
 */

export type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected'
export type TimeType = 'regular' | 'overtime' | 'double'

export const TIME_TYPE_LABEL: Record<TimeType, string> = {
  regular: 'Regular',
  overtime: 'Overtime',
  double: 'Double time',
}

export interface Worker {
  id: string
  companyId: string | null
  companyName: string | null
  userId: string | null
  name: string
  employeeNumber: string | null
  trade: string | null
  classification: string | null
  hourlyRate: number | null
  overtimeMultiplier: number
  status: 'active' | 'inactive'
  notes: string | null
  crews?: Array<{ id: string; name: string | null }>
  createdAt: string | null
  updatedAt: string | null
}

export interface WorkerPayload {
  name?: string
  companyId?: string | null
  userId?: string | null
  employeeNumber?: string | null
  trade?: string | null
  classification?: string | null
  hourlyRate?: number | null
  overtimeMultiplier?: number
  status?: 'active' | 'inactive'
  notes?: string | null
}

export interface Crew {
  id: string
  projectId: string
  name: string
  companyId: string | null
  companyName: string | null
  partyId: string | null
  foremanUserId: string | null
  defaultCostCodeId: string | null
  defaultActivityId: string | null
  status: 'active' | 'inactive'
  members: Array<{
    id: string
    workerId: string
    role: string
    sortOrder: number
    worker: Worker | null
  }>
  memberCount: number
  createdAt: string | null
  updatedAt: string | null
}

export interface CrewPayload {
  name?: string
  companyId?: string | null
  foremanUserId?: string | null
  defaultCostCodeId?: string | null
  defaultActivityId?: string | null
  status?: 'active' | 'inactive'
  workerIds?: string[]
}

export interface TimeEntry {
  id: string
  workerId: string
  worker: {
    id: string
    name: string
    trade: string | null
    companyName: string | null
  } | null
  activityId: string | null
  activity: { id: string; name: string; code: string | null } | null
  costCodeId: string | null
  costCode: { id: string; code: string; name: string } | null
  budgetLineId: string | null
  locationId: string | null
  location: { id: string; name: string; code: string | null } | null
  timeType: TimeType
  hours: number
  startTime: string | null
  endTime: string | null
  rate: number | null
  amount: number
  notes: string | null
  sortOrder: number
}

export interface TimeEntryPayload {
  workerId: string
  activityId?: string | null
  costCodeId?: string | null
  locationId?: string | null
  timeType?: TimeType
  hours: number
  startTime?: string | null
  endTime?: string | null
  notes?: string | null
}

export interface Timesheet {
  id: string
  projectId: string
  date: string
  crewId: string | null
  crew: { id: string; name: string } | null
  partyId: string | null
  companyId: string | null
  status: TimesheetStatus
  notes: string | null
  regularHours: number
  overtimeHours: number
  totalHours: number
  totalCost: number
  entryCount?: number | null
  workerCount?: number | null
  submittedBy: string | null
  submittedAt: string | null
  approvedBy: string | null
  approvedAt: string | null
  rejectedBy: string | null
  rejectedAt: string | null
  rejectionReason: string | null
  postedAt: string | null
  createdBy: string | null
  path: string
  entries?: TimeEntry[]
  createdAt: string | null
  updatedAt: string | null
}

export interface TimesheetWeek {
  weekStart: string
  weekEnd: string
  days: string[]
  workers: Array<{
    workerId: string
    name: string
    trade: string | null
    companyName: string | null
    days: Array<{ hours: number; overtime: number; timesheetIds: string[] }>
    hours: number
    overtime: number
    cost: number
  }>
  crews: Array<{
    crewId: string | null
    name: string
    hours: number
    cost: number
  }>
  activities: Array<{
    activityId: string | null
    name: string
    code: string | null
    hours: number
    cost: number
  }>
  costCodes: Array<{
    costCodeId: string | null
    code: string | null
    name: string
    hours: number
    cost: number
  }>
  timesheets: Timesheet[]
  totals: {
    hours: number
    overtime: number
    cost: number
    workers: number
    timesheets: number
    dayTotals: number[]
    byStatus: Record<TimesheetStatus, number>
  }
}

export interface ProductivityRow {
  activityId: string
  name: string
  code: string | null
  hours: number
  overtimeHours: number
  cost: number
  workers: number
  days: number
  hoursPerDay: number
  pctComplete: number | null
  labourBudget: number | null
  earnedLabour: number | null
  labourBurnPct: number | null
  costPerPct: number | null
  hoursPerPct: number | null
  warning: string | null
}

const base = (projectId: string) => `/projects/${projectId}/timesheets`
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

export const timesheetKeys = {
  all: (projectId: string) => ['timesheets', projectId] as const,
  workers: (projectId: string, q: string) =>
    ['timesheets', projectId, 'workers', q] as const,
  crews: (projectId: string) => ['timesheets', projectId, 'crews'] as const,
  list: (projectId: string, from: string, to: string) =>
    ['timesheets', projectId, 'list', from, to] as const,
  week: (projectId: string, weekStart: string) =>
    ['timesheets', projectId, 'week', weekStart] as const,
  one: (projectId: string, id: string) =>
    ['timesheets', projectId, 'one', id] as const,
  productivity: (projectId: string, from: string, to: string) =>
    ['timesheets', projectId, 'productivity', from, to] as const,
}

const invalidateAll = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: timesheetKeys.all(projectId) })
  qc.invalidateQueries({ queryKey: ['cost-summary', projectId] })
  qc.invalidateQueries({ queryKey: ['budget', projectId] })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
}

/** Monday of the week containing `date` (YYYY-MM-DD). */
export const weekStartOf = (date: string | Date) => {
  const value = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : date
  const day = value.getUTCDay()
  const monday = new Date(value)
  monday.setUTCDate(value.getUTCDate() - ((day + 6) % 7))
  return monday.toISOString().slice(0, 10)
}

export const shiftDate = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export const useWorkers = (projectId: string, q = '') =>
  useQuery<{ items: Worker[]; total: number }>({
    queryKey: timesheetKeys.workers(projectId, q.trim()),
    queryFn: () =>
      data(
        apiClient.get(`${base(projectId)}/workers`, {
          params: { q: q.trim() || undefined },
        })
      ),
    enabled: Boolean(projectId),
    placeholderData: (previous) => previous,
  })

export const useCreateWorker = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: WorkerPayload) =>
      data<Worker>(apiClient.post(`${base(projectId)}/workers`, payload)),
    onSuccess: () => invalidateAll(qc, projectId),
  })
}

export const useUpdateWorker = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      workerId,
      ...payload
    }: WorkerPayload & { workerId: string }) =>
      data<Worker>(
        apiClient.patch(`${base(projectId)}/workers/${workerId}`, payload)
      ),
    onSuccess: () => invalidateAll(qc, projectId),
  })
}

export const useImportWorkers = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      rows: Array<WorkerPayload & { companyName?: string | null }>
    ) =>
      data<{
        created: number
        updated: number
        skipped: number
        errors: Array<{ row: number; message: string }>
      }>(apiClient.post(`${base(projectId)}/workers/import`, { rows })),
    onSuccess: () => invalidateAll(qc, projectId),
  })
}

export const useCrews = (projectId: string) =>
  useQuery<{ items: Crew[] }>({
    queryKey: timesheetKeys.crews(projectId),
    queryFn: () => data(apiClient.get(`${base(projectId)}/crews`)),
    enabled: Boolean(projectId),
  })

export const useCreateCrew = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CrewPayload) =>
      data<Crew>(apiClient.post(`${base(projectId)}/crews`, payload)),
    onSuccess: () => invalidateAll(qc, projectId),
  })
}

export const useUpdateCrew = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ crewId, ...payload }: CrewPayload & { crewId: string }) =>
      data<Crew>(
        apiClient.patch(`${base(projectId)}/crews/${crewId}`, payload)
      ),
    onSuccess: () => invalidateAll(qc, projectId),
  })
}

export const useDeleteCrew = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (crewId: string) =>
      data<{ deleted: boolean }>(
        apiClient.delete(`${base(projectId)}/crews/${crewId}`)
      ),
    onSuccess: () => invalidateAll(qc, projectId),
  })
}

export const useTimesheets = (projectId: string, from: string, to: string) =>
  useQuery<{
    items: Timesheet[]
    summary: {
      count: number
      regularHours: number
      overtimeHours: number
      totalCost: number
      byStatus: Record<TimesheetStatus, number>
    }
  }>({
    queryKey: timesheetKeys.list(projectId, from, to),
    queryFn: () =>
      data(apiClient.get(base(projectId), { params: { from, to } })),
    enabled: Boolean(projectId),
    placeholderData: (previous) => previous,
  })

export const useTimesheetWeek = (projectId: string, weekStart: string) =>
  useQuery<TimesheetWeek>({
    queryKey: timesheetKeys.week(projectId, weekStart),
    queryFn: () =>
      data(apiClient.get(`${base(projectId)}/week`, { params: { weekStart } })),
    enabled: Boolean(projectId && weekStart),
    placeholderData: (previous) => previous,
  })

export const useTimesheet = (projectId: string, timesheetId: string | null) =>
  useQuery<Timesheet>({
    queryKey: timesheetKeys.one(projectId, timesheetId ?? ''),
    queryFn: () => data(apiClient.get(`${base(projectId)}/${timesheetId}`)),
    enabled: Boolean(projectId && timesheetId),
  })

export const useProductivity = (projectId: string, from: string, to: string) =>
  useQuery<{
    items: ProductivityRow[]
    totals: {
      hours: number
      cost: number
      activities: number
      warnings: number
    }
  }>({
    queryKey: timesheetKeys.productivity(projectId, from, to),
    queryFn: () =>
      data(
        apiClient.get(`${base(projectId)}/productivity`, {
          params: { from, to },
        })
      ),
    enabled: Boolean(projectId),
    placeholderData: (previous) => previous,
  })

export const useCreateTimesheet = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      date: string
      crewId?: string | null
      notes?: string | null
      defaultHours?: number
      entries?: TimeEntryPayload[]
    }) => data<Timesheet>(apiClient.post(base(projectId), payload)),
    onSuccess: () => invalidateAll(qc, projectId),
  })
}

export const useUpdateTimesheet = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      timesheetId,
      ...payload
    }: {
      timesheetId: string
      date?: string
      notes?: string | null
      entries?: TimeEntryPayload[]
    }) =>
      data<Timesheet>(
        apiClient.patch(`${base(projectId)}/${timesheetId}`, payload)
      ),
    onSuccess: () => invalidateAll(qc, projectId),
  })
}

export const useDeleteTimesheet = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (timesheetId: string) =>
      data<{ deleted: boolean }>(
        apiClient.delete(`${base(projectId)}/${timesheetId}`)
      ),
    onSuccess: () => invalidateAll(qc, projectId),
  })
}

export const useTimesheetTransition = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      timesheetId,
      action,
      reason,
    }: {
      timesheetId: string
      action: 'submit' | 'approve' | 'reject' | 'reopen'
      reason?: string | null
    }) =>
      data<Timesheet>(
        apiClient.post(
          `${base(projectId)}/${timesheetId}/${action}`,
          reason !== undefined ? { reason } : {}
        )
      ),
    onSuccess: () => invalidateAll(qc, projectId),
  })
}

export const downloadTimesheetsXlsx = async (
  projectId: string,
  params: { from: string; to: string }
) => {
  const response = await apiClient.get(`${base(projectId)}/export.xlsx`, {
    params,
    responseType: 'blob',
    timeout: 120_000,
  })
  const disposition = String(response.headers?.['content-disposition'] ?? '')
  const match = /filename="?([^";]+)"?/.exec(disposition)
  const url = URL.createObjectURL(new Blob([response.data]))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = match?.[1] ?? 'timesheets.xlsx'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
