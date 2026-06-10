import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export type ReportStatus = 'draft' | 'submitted' | 'approved' | 'rejected'

export type SitePhoto = {
  key?: string | null
  url?: string | null
  filename?: string | null
  originalName?: string | null
  mimeType?: string | null
  size?: number | null
  storage?: string | null
  caption?: string | null
  takenAt?: string | null
  uploadedBy?: string | null
  uploadedAt?: string | null
}

export type SiteResourceRow = {
  trade?: string
  workers?: number
  hours?: number
  materialId?: string
  equipmentId?: string
  name?: string
  qty?: number
  unit?: string
}

export type SiteWeather = {
  summary?: string | null
  temperatureC?: number | null
  condition?: string | null
  wind?: string | null
  rainfallMm?: number | null
  delayImpact?: boolean
}

export type SiteIssue = {
  description?: string | null
  title?: string | null
  severity?: string | null
  owner?: string | null
  status?: string | null
}

export type SiteLineSummary = {
  totalWorkers: number
  totalManHours: number
  equipmentHours: number
  materialLines: number
  photoCount: number
  issueCount: number
}

export type DailyReport = {
  id: string
  projectId: string
  activityId: string
  engineerId: string
  date: string
  shift: 'day' | 'night' | 'swing'
  pctProgress: number
  weather: SiteWeather | null
  manpower: SiteResourceRow[]
  materials: SiteResourceRow[]
  equipment: SiteResourceRow[]
  issues: SiteIssue[]
  photos: SitePhoto[]
  notes: string | null
  lineSummary: SiteLineSummary
  clientRequestId: string | null
  clientCreatedAt: string | null
  deviceId: string | null
  status: ReportStatus
  submittedAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  rejectionReason: string | null
  activity?: {
    id: string
    name: string
    wbsCode: string | null
    p6ActivityId?: string | null
  }
}

export type SiteDiary = {
  id: string
  projectId: string
  engineerId: string | null
  date: string
  shift: 'day' | 'night' | 'swing'
  weather: string | null
  weatherDetails: SiteWeather | null
  workers: number
  visitors: string | null
  workDone: string | null
  issues: string | null
  issueItems: SiteIssue[]
  instructions: string | null
  manpower: SiteResourceRow[]
  materials: SiteResourceRow[]
  equipment: SiteResourceRow[]
  photos: SitePhoto[]
  notes: string | null
  lineSummary: SiteLineSummary
  clientRequestId: string | null
  clientCreatedAt: string | null
  deviceId: string | null
  status: ReportStatus
  submittedAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  rejectionReason: string | null
}

export const useDailyReports = (projectId: string) =>
  useQuery<DailyReport[]>({
    queryKey: ['daily-reports', projectId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/daily-reports`)
        .then((r) => r.data.data as DailyReport[]),
    enabled: !!projectId,
  })

export const useSiteDiaries = (projectId: string) =>
  useQuery<SiteDiary[]>({
    queryKey: ['site-diaries', projectId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/site-diaries`)
        .then((r) => r.data.data as SiteDiary[]),
    enabled: !!projectId,
  })

export const useUploadSitePhotos = (projectId: string) =>
  useMutation({
    mutationFn: (files: File[]) => {
      const fd = new FormData()
      files.forEach((file) => fd.append('files', file))
      return apiClient
        .post(`/projects/${projectId}/site-reporting/uploads`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((r) => r.data.data as SitePhoto[])
    },
  })

export const useRefreshSiteReporting = (projectId: string) => {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['daily-reports', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['site-diaries', projectId] }),
      queryClient.invalidateQueries({
        queryKey: ['progress-submissions', projectId],
      }),
      queryClient.invalidateQueries({ queryKey: ['schedule', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['audit-events', projectId] }),
    ])
}
