/** Server state for the site-reporting and schedule screens (M3). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { keys } from '@/api/query'
import {
  addDailyLogEntry,
  copyPreviousDailyLog,
  createTimesheet,
  deleteDailyLogEntry,
  getActivity,
  getDailyLog,
  getDailyLogSettings,
  getLookahead,
  getProgressMethod,
  getTimesheet,
  listActivitiesFull,
  listCrews,
  listDailyLogDays,
  listLookaheads,
  listPhotos,
  listProgressSubmissions,
  listTimesheets,
  listWorkers,
  refreshDailyLogWeather,
  setLookaheadItemStatus,
  submitDailyLog,
  submitProgress,
  submitTimesheet,
  updateDailyLogEntry,
  updateDailyLogSummary,
  updatePhoto,
} from '@/api/site-endpoints'
import type { DailyLog, DailyLogSection, EntryInput, ProgressInput, TimesheetEntry } from '@/api/site-types'

const scoped = (projectId: string, ...rest: readonly unknown[]) => keys.projectScoped(projectId, ...rest)

// ── Daily log ──

export function useDailyLogSettings(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'daily-log', 'settings'), queryFn: ({ signal }) => getDailyLogSettings(projectId!, signal), enabled: !!projectId, staleTime: 10 * 60_000 })
}

export function useDailyLogDays(projectId: string | null, from: string, to: string) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'daily-log', 'days', from, to), queryFn: ({ signal }) => listDailyLogDays(projectId!, from, to, signal), enabled: !!projectId, select: (d) => d.items })
}

export function useDailyLog(projectId: string | null, date: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'daily-log', date), queryFn: ({ signal }) => getDailyLog(projectId!, date!, signal), enabled: !!projectId && !!date })
}

export function useDailyLogActions(projectId: string, date: string) {
  const client = useQueryClient()
  const put = (log: DailyLog) => {
    client.setQueryData(scoped(projectId, 'daily-log', date), log)
    void client.invalidateQueries({ queryKey: scoped(projectId, 'daily-log', 'days') })
  }
  const addEntry = useMutation({ mutationFn: ({ section, body }: { section: DailyLogSection; body: EntryInput }) => addDailyLogEntry(projectId, date, section, body), onSuccess: put })
  const updateEntry = useMutation({ mutationFn: ({ section, entryId, body }: { section: DailyLogSection; entryId: string; body: Partial<EntryInput> }) => updateDailyLogEntry(projectId, date, section, entryId, body), onSuccess: put })
  const removeEntry = useMutation({ mutationFn: ({ section, entryId }: { section: DailyLogSection; entryId: string }) => deleteDailyLogEntry(projectId, date, section, entryId), onSuccess: put })
  const copyPrevious = useMutation({ mutationFn: (sections: DailyLogSection[]) => copyPreviousDailyLog(projectId, date, sections), onSuccess: put })
  const submit = useMutation({ mutationFn: () => submitDailyLog(projectId, date), onSuccess: put })
  const refreshWeather = useMutation({ mutationFn: () => refreshDailyLogWeather(projectId, date), onSuccess: put })
  const saveSummary = useMutation({ mutationFn: (summary: string) => updateDailyLogSummary(projectId, date, { summary }), onSuccess: put })
  return { addEntry, updateEntry, removeEntry, copyPrevious, submit, refreshWeather, saveSummary }
}

// ── Activities and progress ──

export function useActivitiesFull(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'activities', 'full'), queryFn: ({ signal }) => listActivitiesFull(projectId!, signal), enabled: !!projectId, staleTime: 2 * 60_000 })
}

export function useActivity(projectId: string | null, activityId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'activity', activityId), queryFn: ({ signal }) => getActivity(projectId!, activityId!, signal), enabled: !!projectId && !!activityId })
}

export function useProgressMethod(projectId: string | null, activityId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'activity', activityId, 'method'), queryFn: ({ signal }) => getProgressMethod(projectId!, activityId!, signal), enabled: !!projectId && !!activityId })
}

export function useProgressSubmissions(projectId: string | null, activityId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'activity', activityId, 'submissions'), queryFn: ({ signal }) => listProgressSubmissions(projectId!, activityId!, signal), enabled: !!projectId && !!activityId })
}

export function useSubmitProgress(projectId: string, activityId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: ProgressInput) => submitProgress(projectId, activityId, body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: scoped(projectId, 'activity', activityId) })
      void client.invalidateQueries({ queryKey: scoped(projectId, 'activities') })
      void client.invalidateQueries({ queryKey: scoped(projectId, 'health') })
    },
  })
}

// ── Lookaheads ──

export function useLookaheads(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'lookaheads'), queryFn: ({ signal }) => listLookaheads(projectId!, signal), enabled: !!projectId })
}

export function useLookahead(projectId: string | null, lookaheadId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'lookahead', lookaheadId), queryFn: ({ signal }) => getLookahead(projectId!, lookaheadId!, signal), enabled: !!projectId && !!lookaheadId })
}

export function useLookaheadItemStatus(projectId: string, lookaheadId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: { status: string; varianceReason?: string; pctComplete?: number; notes?: string } }) => setLookaheadItemStatus(projectId, lookaheadId, itemId, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: scoped(projectId, 'lookahead', lookaheadId) }),
  })
}

// ── Photos ──

export function usePhotos(projectId: string | null, filters: { search?: string; tag?: string; recordType?: string; recordId?: string } = {}) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'photos', filters), queryFn: ({ signal }) => listPhotos(projectId!, filters, signal), enabled: !!projectId, placeholderData: (previous) => previous })
}

export function useUpdatePhoto(projectId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ photoId, body }: { photoId: string; body: { caption?: string; tags?: string[]; locationId?: string | null } }) => updatePhoto(projectId, photoId, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: scoped(projectId, 'photos') }),
  })
}

// ── Timesheets ──

export function useTimesheets(projectId: string | null, filters: { from?: string; to?: string; status?: string } = {}) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'timesheets', filters), queryFn: ({ signal }) => listTimesheets(projectId!, filters, signal), enabled: !!projectId })
}

export function useTimesheet(projectId: string | null, timesheetId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'timesheet', timesheetId), queryFn: ({ signal }) => getTimesheet(projectId!, timesheetId!, signal), enabled: !!projectId && !!timesheetId })
}

export function useCrews(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'crews'), queryFn: ({ signal }) => listCrews(projectId!, signal), enabled: !!projectId, select: (d) => d.items, staleTime: 10 * 60_000 })
}

export function useWorkers(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'workers'), queryFn: ({ signal }) => listWorkers(projectId!, signal), enabled: !!projectId, select: (d) => d.items.filter((w) => w.status !== 'inactive'), staleTime: 10 * 60_000 })
}

export function useTimesheetActions(projectId: string) {
  const client = useQueryClient()
  const settle = () => void client.invalidateQueries({ queryKey: scoped(projectId, 'timesheets') })
  const create = useMutation({ mutationFn: (body: { date: string; crewId?: string; companyId?: string; notes?: string; defaultHours?: number; clientRequestId: string; entries: TimesheetEntry[] }) => createTimesheet(projectId, body), onSuccess: settle })
  const submit = useMutation({
    mutationFn: (timesheetId: string) => submitTimesheet(projectId, timesheetId),
    onSuccess: (_d, timesheetId) => {
      settle()
      void client.invalidateQueries({ queryKey: scoped(projectId, 'timesheet', timesheetId) })
    },
  })
  return { create, submit }
}
