import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import {
  Camera,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  CloudOff,
  CloudSun,
  Image as ImageIcon,
  Package,
  Plus,
  Save,
  Send,
  Trash2,
  Truck,
  Users,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { handleServerError } from '@/lib/handle-server-error'
import {
  isQueued,
  newClientRequestId,
  tempPlaceholder,
} from '@/lib/offline/outbox'
import { sendOrQueue } from '@/lib/offline/queue-request'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import { useEquipment } from '@/features/equipment/hooks/use-equipment'
import type { ScheduleActivity } from '@/features/schedule/data/schema'
import {
  type DailyReport,
  type ReportStatus,
  type SiteDiary,
  useDailyReports,
  useRefreshSiteReporting,
  useSiteDiaries,
  useUploadSitePhotos,
} from '../hooks/use-site-reporting'
import { DailyLogPanel } from './daily-log-panel'

type Props = {
  projectId: string
  activities: ScheduleActivity[]
  /** Day to open in the daily log (deep link `?date=YYYY-MM-DD`). */
  initialDate?: string | null
}

type CrewRow = { trade: string; workers: string; hours: string }
type EquipmentRow = { equipmentId: string; name: string; hours: string }
type MaterialRow = { name: string; qty: string; unit: string }
type ShiftValue = 'day' | 'night' | 'swing'
type RejectTarget = {
  kind: 'report' | 'diary'
  id: string
  title: string
}
type DailyDraft = {
  activityId: string
  date: string
  shift: ShiftValue
  pct: string
  weather: string
  issue: string
  crew: CrewRow[]
  equipment: EquipmentRow[]
  materials: MaterialRow[]
  notes: string
}
type DiaryDraft = {
  date: string
  shift: ShiftValue
  weather: string
  workers: string
  visitors: string
  workDone: string
  issues: string
  instructions: string
  crew: CrewRow[]
  equipment: EquipmentRow[]
  materials: MaterialRow[]
  notes: string
}

const today = () => new Date().toISOString().slice(0, 10)
const UNLISTED_EQUIPMENT_VALUE = '__unlisted__'
const blankCrew = (): CrewRow => ({ trade: '', workers: '', hours: '8' })
const blankEquipment = (): EquipmentRow => ({
  equipmentId: '',
  name: '',
  hours: '',
})
const blankMaterial = (): MaterialRow => ({ name: '', qty: '', unit: '' })

const statusClasses: Record<ReportStatus, string> = {
  draft: 'border-slate-300 text-slate-700 dark:text-slate-200',
  submitted: 'border-blue-300 text-blue-700 dark:text-blue-200',
  approved: 'border-green-300 text-green-700 dark:text-green-200',
  rejected: 'border-red-300 text-red-700 dark:text-red-200',
}

const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : '-'

const activityLabel = (activity: ScheduleActivity) =>
  `${activity.wbsCode ? `${activity.wbsCode} - ` : ''}${activity.name}`

const siteDraftKey = (projectId: string, kind: 'daily' | 'diary') =>
  `pmc-site-reporting:${projectId}:${kind}`

const readSiteDraft = <T,>(projectId: string, kind: 'daily' | 'diary') => {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(siteDraftKey(projectId, kind))
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const writeSiteDraft = (
  projectId: string,
  kind: 'daily' | 'diary',
  payload: DailyDraft | DiaryDraft
) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    siteDraftKey(projectId, kind),
    JSON.stringify(payload)
  )
}

const clearSiteDraft = (projectId: string, kind: 'daily' | 'diary') => {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(siteDraftKey(projectId, kind))
}

const getDeviceId = () => {
  if (typeof window === 'undefined') return 'web'
  const key = 'pmc-site-reporting-device-id'
  const existing = window.localStorage.getItem(key)
  if (existing) return existing
  const generated =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  const deviceId = `web-${generated}`
  window.localStorage.setItem(key, deviceId)
  return deviceId
}

const clientMetadata = (kind: 'daily' | 'diary') => ({
  clientRequestId: `${kind}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
  clientCreatedAt: new Date().toISOString(),
  deviceId: getDeviceId(),
})

function StatusBadge({ status }: { status: ReportStatus }) {
  return (
    <Badge variant='outline' className={statusClasses[status]}>
      {status}
    </Badge>
  )
}

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string | number
  icon: typeof ClipboardCheck
}) {
  return (
    <div className='rounded-md border bg-card p-3'>
      <div className='flex items-center justify-between gap-2'>
        <p className='text-xs font-medium text-muted-foreground'>{label}</p>
        <Icon className='h-4 w-4 text-muted-foreground' />
      </div>
      <p className='mt-2 text-2xl font-semibold'>{value}</p>
    </div>
  )
}

function EmptyQueue() {
  return (
    <div className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>
      No submitted site records.
    </div>
  )
}

export function SiteReportingDashboard({
  projectId,
  activities,
  initialDate,
}: Props) {
  const selectableActivities = useMemo(
    () => activities.filter((activity) => !activity.isMilestone),
    [activities]
  )
  const dailyReports = useDailyReports(projectId)
  const siteDiaries = useSiteDiaries(projectId)
  const { data: equipmentMaster = [] } = useEquipment(projectId)
  const uploadPhotos = useUploadSitePhotos(projectId)
  const refreshSiteReporting = useRefreshSiteReporting(projectId)

  const canSubmitDailyReport = useCanPerform(
    'progress',
    'submit',
    'daily_report.submit'
  )
  const canSubmitSiteDiary = useCanPerform(
    'progress',
    'submit',
    'site_diary.submit'
  )
  const canApproveDailyReport = useCanPerform(
    'progress',
    'approve',
    'daily_report.approve'
  )
  const canRejectDailyReport = useCanPerform(
    'progress',
    'approve',
    'daily_report.reject'
  )
  const canApproveSiteDiary = useCanPerform(
    'progress',
    'approve',
    'site_diary.approve'
  )
  const canRejectSiteDiary = useCanPerform(
    'progress',
    'approve',
    'site_diary.reject'
  )

  const [dailyActivityId, setDailyActivityId] = useState(
    selectableActivities[0]?.id ?? ''
  )
  const [dailyDate, setDailyDate] = useState(today())
  const [dailyShift, setDailyShift] = useState<ShiftValue>('day')
  const [dailyPct, setDailyPct] = useState('0')
  const [dailyWeather, setDailyWeather] = useState('')
  const [dailyIssue, setDailyIssue] = useState('')
  const [dailyCrew, setDailyCrew] = useState<CrewRow[]>([blankCrew()])
  const [dailyEquipment, setDailyEquipment] = useState<EquipmentRow[]>([
    blankEquipment(),
  ])
  const [dailyMaterials, setDailyMaterials] = useState<MaterialRow[]>([
    blankMaterial(),
  ])
  const [dailyNotes, setDailyNotes] = useState('')
  const [dailyPhotoFiles, setDailyPhotoFiles] = useState<File[]>([])

  const [diaryDate, setDiaryDate] = useState(today())
  const [diaryShift, setDiaryShift] = useState<ShiftValue>('day')
  const [diaryWeather, setDiaryWeather] = useState('')
  const [diaryWorkers, setDiaryWorkers] = useState('')
  const [diaryVisitors, setDiaryVisitors] = useState('')
  const [diaryWorkDone, setDiaryWorkDone] = useState('')
  const [diaryIssues, setDiaryIssues] = useState('')
  const [diaryInstructions, setDiaryInstructions] = useState('')
  const [diaryCrew, setDiaryCrew] = useState<CrewRow[]>([blankCrew()])
  const [diaryEquipment, setDiaryEquipment] = useState<EquipmentRow[]>([
    blankEquipment(),
  ])
  const [diaryMaterials, setDiaryMaterials] = useState<MaterialRow[]>([
    blankMaterial(),
  ])
  const [diaryNotes, setDiaryNotes] = useState('')
  const [diaryPhotoFiles, setDiaryPhotoFiles] = useState<File[]>([])
  const [isOffline, setIsOffline] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const reports = dailyReports.data ?? []
  const diaries = siteDiaries.data ?? []
  const submittedReports = reports.filter(
    (report) => report.status === 'submitted'
  )
  const submittedDiaries = diaries.filter(
    (diary) => diary.status === 'submitted'
  )
  const approvedToday =
    reports.filter(
      (report) =>
        report.status === 'approved' && report.date.slice(0, 10) === today()
    ).length +
    diaries.filter(
      (diary) =>
        diary.status === 'approved' && diary.date.slice(0, 10) === today()
    ).length
  const photoCount =
    reports.reduce((sum, report) => sum + report.photos.length, 0) +
    diaries.reduce((sum, diary) => sum + diary.photos.length, 0)

  useEffect(() => {
    if (!dailyActivityId && selectableActivities[0]) {
      setDailyActivityId(selectableActivities[0].id)
    }
  }, [dailyActivityId, selectableActivities])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const updateStatus = () => setIsOffline(!window.navigator.onLine)
    updateStatus()
    window.addEventListener('online', updateStatus)
    window.addEventListener('offline', updateStatus)
    return () => {
      window.removeEventListener('online', updateStatus)
      window.removeEventListener('offline', updateStatus)
    }
  }, [])

  useEffect(() => {
    const dailyDraft = readSiteDraft<DailyDraft>(projectId, 'daily')
    if (dailyDraft) {
      setDailyActivityId(
        dailyDraft.activityId || selectableActivities[0]?.id || ''
      )
      setDailyDate(dailyDraft.date || today())
      setDailyShift(dailyDraft.shift || 'day')
      setDailyPct(dailyDraft.pct || '0')
      setDailyWeather(dailyDraft.weather || '')
      setDailyIssue(dailyDraft.issue || '')
      setDailyCrew(dailyDraft.crew?.length ? dailyDraft.crew : [blankCrew()])
      setDailyEquipment(
        dailyDraft.equipment?.length ? dailyDraft.equipment : [blankEquipment()]
      )
      setDailyMaterials(
        dailyDraft.materials?.length ? dailyDraft.materials : [blankMaterial()]
      )
      setDailyNotes(dailyDraft.notes || '')
    }

    const diaryDraft = readSiteDraft<DiaryDraft>(projectId, 'diary')
    if (diaryDraft) {
      setDiaryDate(diaryDraft.date || today())
      setDiaryShift(diaryDraft.shift || 'day')
      setDiaryWeather(diaryDraft.weather || '')
      setDiaryWorkers(diaryDraft.workers || '')
      setDiaryVisitors(diaryDraft.visitors || '')
      setDiaryWorkDone(diaryDraft.workDone || '')
      setDiaryIssues(diaryDraft.issues || '')
      setDiaryInstructions(diaryDraft.instructions || '')
      setDiaryCrew(diaryDraft.crew?.length ? diaryDraft.crew : [blankCrew()])
      setDiaryEquipment(
        diaryDraft.equipment?.length ? diaryDraft.equipment : [blankEquipment()]
      )
      setDiaryMaterials(
        diaryDraft.materials?.length ? diaryDraft.materials : [blankMaterial()]
      )
      setDiaryNotes(diaryDraft.notes || '')
    }
  }, [projectId, selectableActivities])

  const uploadSelectedPhotos = async (files: File[]) => {
    if (!files.length) return []
    return uploadPhotos.mutateAsync(files)
  }

  // Offline: the photos wait in the outbox and attach once the report exists.
  const queuePhotosFor = ({
    recordType,
    tempId,
    files,
    label,
  }: {
    recordType: 'daily_report' | 'site_diary'
    tempId: string
    files: File[]
    label: string
  }) =>
    sendOrQueue<null>({
      projectId,
      kind: 'attachment',
      label,
      method: 'POST',
      url: `/projects/${projectId}/attachments`,
      form: {
        recordType,
        recordId: tempPlaceholder(tempId),
        role: 'photo',
      },
      files,
      dependsOn: tempId,
      parse: () => null,
    })

  const resetDailyForm = () => {
    setDailyPct('0')
    setDailyWeather('')
    setDailyIssue('')
    setDailyCrew([blankCrew()])
    setDailyEquipment([blankEquipment()])
    setDailyMaterials([blankMaterial()])
    setDailyNotes('')
    setDailyPhotoFiles([])
  }

  const resetDiaryForm = () => {
    setDiaryWeather('')
    setDiaryWorkers('')
    setDiaryVisitors('')
    setDiaryWorkDone('')
    setDiaryIssues('')
    setDiaryInstructions('')
    setDiaryCrew([blankCrew()])
    setDiaryEquipment([blankEquipment()])
    setDiaryMaterials([blankMaterial()])
    setDiaryNotes('')
    setDiaryPhotoFiles([])
  }

  const currentDailyDraft = (): DailyDraft => ({
    activityId: dailyActivityId,
    date: dailyDate,
    shift: dailyShift,
    pct: dailyPct,
    weather: dailyWeather,
    issue: dailyIssue,
    crew: dailyCrew,
    equipment: dailyEquipment,
    materials: dailyMaterials,
    notes: dailyNotes,
  })

  const currentDiaryDraft = (): DiaryDraft => ({
    date: diaryDate,
    shift: diaryShift,
    weather: diaryWeather,
    workers: diaryWorkers,
    visitors: diaryVisitors,
    workDone: diaryWorkDone,
    issues: diaryIssues,
    instructions: diaryInstructions,
    crew: diaryCrew,
    equipment: diaryEquipment,
    materials: diaryMaterials,
    notes: diaryNotes,
  })

  const saveLocalDailyDraft = () => {
    writeSiteDraft(projectId, 'daily', currentDailyDraft())
    toast.success('Daily report saved locally')
  }

  const saveLocalDiaryDraft = () => {
    writeSiteDraft(projectId, 'diary', currentDiaryDraft())
    toast.success('Site diary saved locally')
  }

  const runDailyAction = (status: 'draft' | 'submitted') => {
    if (isOffline && status === 'draft') {
      saveLocalDailyDraft()
      return
    }
    // Submitting offline goes through the outbox (OCTA-MOB-PWA-018).
    dailyMutation.mutate(status)
  }

  const runDiaryAction = (status: 'draft' | 'submitted') => {
    if (isOffline && status === 'draft') {
      saveLocalDiaryDraft()
      return
    }
    diaryMutation.mutate(status)
  }

  const dailyMutation = useMutation({
    mutationFn: async (status: 'draft' | 'submitted') => {
      if (!dailyActivityId) throw new Error('Activity is required')
      const photos = isOffline
        ? []
        : await uploadSelectedPhotos(dailyPhotoFiles)
      const meta = clientMetadata('daily')
      const tempId = newClientRequestId('daily-tmp')
      const result = await sendOrQueue<DailyReport>({
        projectId,
        kind: 'daily_report',
        label: `Daily report ${dailyDate}`,
        method: 'POST',
        url: `/projects/${projectId}/daily-reports`,
        clientRequestId: meta.clientRequestId,
        tempId,
        parse: (data) => (data as { data: DailyReport }).data,
        body: {
          activityId: dailyActivityId,
          date: dailyDate,
          shift: dailyShift,
          pctProgress: Number(dailyPct || 0),
          weather: dailyWeather.trim()
            ? { summary: dailyWeather.trim() }
            : undefined,
          manpower: dailyCrew
            .filter((row) => row.trade || row.workers || row.hours)
            .map((row) => ({
              trade: row.trade || 'crew',
              workers: Number(row.workers || 0),
              hours: Number(row.hours || 0),
            })),
          equipment: dailyEquipment
            .filter((row) => row.equipmentId || row.name || row.hours)
            .map((row) => ({
              equipmentId: row.equipmentId || undefined,
              name: row.name || 'site equipment',
              hours: Number(row.hours || 0),
            })),
          materials: dailyMaterials
            .filter((row) => row.name || row.qty || row.unit)
            .map((row) => ({
              name: row.name || 'material',
              qty: Number(row.qty || 0),
              unit: row.unit || 'unit',
            })),
          issues: dailyIssue.trim()
            ? [
                {
                  description: dailyIssue.trim(),
                  severity: 'medium',
                  status: 'open',
                },
              ]
            : [],
          photos,
          notes: dailyNotes,
          status,
          ...meta,
          progress: {
            method: 'percent',
            pctComplete: Number(dailyPct || 0),
            evidence: photos.length ? { photos } : undefined,
          },
        },
      })
      if (isQueued(result) && dailyPhotoFiles.length) {
        await queuePhotosFor({
          recordType: 'daily_report',
          tempId,
          files: dailyPhotoFiles,
          label: `Photos for daily report ${dailyDate}`,
        })
      }
      return result
    },
    onSuccess: async (result, status) => {
      if (isQueued(result)) {
        toast.success(
          'Daily report saved to the outbox — it uploads when you are back online'
        )
      } else {
        toast.success(
          status === 'draft' ? 'Daily report saved' : 'Daily report submitted'
        )
      }
      resetDailyForm()
      clearSiteDraft(projectId, 'daily')
      await refreshSiteReporting()
    },
    onError: (error) => handleServerError(error),
  })

  const diaryMutation = useMutation({
    mutationFn: async (status: 'draft' | 'submitted') => {
      const photos = isOffline
        ? []
        : await uploadSelectedPhotos(diaryPhotoFiles)
      const meta = clientMetadata('diary')
      const tempId = newClientRequestId('diary-tmp')
      const result = await sendOrQueue<SiteDiary>({
        projectId,
        kind: 'site_diary',
        label: `Site diary ${diaryDate}`,
        method: 'POST',
        url: `/projects/${projectId}/site-diaries`,
        clientRequestId: meta.clientRequestId,
        tempId,
        parse: (data) => (data as { data: SiteDiary }).data,
        body: {
          date: diaryDate,
          shift: diaryShift,
          weather: diaryWeather,
          weatherDetails: diaryWeather.trim()
            ? { summary: diaryWeather.trim() }
            : undefined,
          workers: Number(diaryWorkers || 0),
          visitors: diaryVisitors,
          workDone: diaryWorkDone,
          issues: diaryIssues,
          issueItems: diaryIssues.trim()
            ? [
                {
                  description: diaryIssues.trim(),
                  severity: 'medium',
                  status: 'open',
                },
              ]
            : [],
          instructions: diaryInstructions,
          manpower: diaryCrew
            .filter((row) => row.trade || row.workers || row.hours)
            .map((row) => ({
              trade: row.trade || 'crew',
              workers: Number(row.workers || 0),
              hours: Number(row.hours || 0),
            })),
          equipment: diaryEquipment
            .filter((row) => row.equipmentId || row.name || row.hours)
            .map((row) => ({
              equipmentId: row.equipmentId || undefined,
              name: row.name || 'site equipment',
              hours: Number(row.hours || 0),
            })),
          materials: diaryMaterials
            .filter((row) => row.name || row.qty || row.unit)
            .map((row) => ({
              name: row.name || 'material',
              qty: Number(row.qty || 0),
              unit: row.unit || 'unit',
            })),
          photos,
          notes: diaryNotes,
          status,
          ...meta,
        },
      })
      if (isQueued(result) && diaryPhotoFiles.length) {
        await queuePhotosFor({
          recordType: 'site_diary',
          tempId,
          files: diaryPhotoFiles,
          label: `Photos for site diary ${diaryDate}`,
        })
      }
      return result
    },
    onSuccess: async (result, status) => {
      if (isQueued(result)) {
        toast.success(
          'Site diary saved to the outbox — it uploads when you are back online'
        )
      } else {
        toast.success(
          status === 'draft' ? 'Site diary saved' : 'Site diary submitted'
        )
      }
      resetDiaryForm()
      clearSiteDraft(projectId, 'diary')
      await refreshSiteReporting()
    },
    onError: (error) => handleServerError(error),
  })

  const approveReport = useMutation({
    mutationFn: (reportId: string) =>
      apiClient
        .post(`/projects/${projectId}/daily-reports/${reportId}/approve`)
        .then((r) => r.data.data),
    onSuccess: async () => {
      toast.success('Daily report approved')
      await refreshSiteReporting()
    },
    onError: (error) => handleServerError(error),
  })

  const rejectReport = useMutation({
    mutationFn: ({ reportId, reason }: { reportId: string; reason: string }) =>
      apiClient
        .post(`/projects/${projectId}/daily-reports/${reportId}/reject`, {
          reason,
        })
        .then((r) => r.data.data),
    onSuccess: async () => {
      toast.success('Daily report rejected')
      setRejectTarget(null)
      setRejectReason('')
      await refreshSiteReporting()
    },
    onError: (error) => handleServerError(error),
  })

  const approveDiary = useMutation({
    mutationFn: (diaryId: string) =>
      apiClient
        .post(`/projects/${projectId}/site-diaries/${diaryId}/approve`)
        .then((r) => r.data.data),
    onSuccess: async () => {
      toast.success('Site diary approved')
      await refreshSiteReporting()
    },
    onError: (error) => handleServerError(error),
  })

  const rejectDiary = useMutation({
    mutationFn: ({ diaryId, reason }: { diaryId: string; reason: string }) =>
      apiClient
        .post(`/projects/${projectId}/site-diaries/${diaryId}/reject`, {
          reason,
        })
        .then((r) => r.data.data),
    onSuccess: async () => {
      toast.success('Site diary rejected')
      setRejectTarget(null)
      setRejectReason('')
      await refreshSiteReporting()
    },
    onError: (error) => handleServerError(error),
  })

  const updateCrew = (
    rows: CrewRow[],
    setRows: (rows: CrewRow[]) => void,
    index: number,
    patch: Partial<CrewRow>
  ) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const updateEquipment = (
    rows: EquipmentRow[],
    setRows: (rows: EquipmentRow[]) => void,
    index: number,
    patch: Partial<EquipmentRow>
  ) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const updateMaterial = (
    rows: MaterialRow[],
    setRows: (rows: MaterialRow[]) => void,
    index: number,
    patch: Partial<MaterialRow>
  ) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const renderCrewRows = (
    rows: CrewRow[],
    setRows: (rows: CrewRow[]) => void
  ) => (
    <div className='space-y-2'>
      <div className='flex items-center justify-between gap-2'>
        <Label className='text-xs'>Manpower</Label>
        <Button
          type='button'
          size='sm'
          variant='outline'
          className='min-h-10'
          onClick={() => setRows([...rows, blankCrew()])}
        >
          <Plus className='mr-1.5 h-4 w-4' />
          Crew
        </Button>
      </div>
      {rows.map((row, index) => (
        <div
          key={index}
          className='grid gap-2 sm:grid-cols-[minmax(0,1fr)_96px_96px_36px]'
        >
          <Input
            placeholder='Trade'
            value={row.trade}
            onChange={(event) =>
              updateCrew(rows, setRows, index, { trade: event.target.value })
            }
          />
          <Input
            type='number'
            min={0}
            placeholder='Workers'
            value={row.workers}
            onChange={(event) =>
              updateCrew(rows, setRows, index, { workers: event.target.value })
            }
          />
          <Input
            type='number'
            min={0}
            placeholder='Hours'
            value={row.hours}
            onChange={(event) =>
              updateCrew(rows, setRows, index, { hours: event.target.value })
            }
          />
          <Button
            type='button'
            size='icon'
            variant='ghost'
            className='size-10 sm:size-9'
            title='Remove row'
            aria-label='Remove manpower row'
            onClick={() => setRows(rows.filter((_, i) => i !== index))}
            disabled={rows.length === 1}
          >
            <Trash2 className='h-4 w-4' />
          </Button>
        </div>
      ))}
    </div>
  )

  const renderEquipmentRows = (
    rows: EquipmentRow[],
    setRows: (rows: EquipmentRow[]) => void
  ) => (
    <div className='space-y-2'>
      <div className='flex items-center justify-between gap-2'>
        <Label className='text-xs'>Equipment</Label>
        <Button
          type='button'
          size='sm'
          variant='outline'
          className='min-h-10'
          onClick={() => setRows([...rows, blankEquipment()])}
        >
          <Plus className='mr-1.5 h-4 w-4' />
          Equipment
        </Button>
      </div>
      {rows.map((row, index) => (
        <div
          key={index}
          className='grid gap-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_96px_36px]'
        >
          <Select
            value={row.equipmentId || UNLISTED_EQUIPMENT_VALUE}
            onValueChange={(value) => {
              if (value === UNLISTED_EQUIPMENT_VALUE) {
                updateEquipment(rows, setRows, index, {
                  equipmentId: '',
                  name: '',
                })
                return
              }

              const selected = equipmentMaster.find((item) => item.id === value)
              updateEquipment(rows, setRows, index, {
                equipmentId: value,
                name: selected?.name || row.name,
              })
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder='Equipment' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNLISTED_EQUIPMENT_VALUE}>Unlisted</SelectItem>
              {equipmentMaster.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder='Name'
            value={row.name}
            readOnly={Boolean(row.equipmentId)}
            onChange={(event) =>
              updateEquipment(rows, setRows, index, {
                name: event.target.value,
              })
            }
          />
          <Input
            type='number'
            min={0}
            placeholder='Hours'
            value={row.hours}
            onChange={(event) =>
              updateEquipment(rows, setRows, index, {
                hours: event.target.value,
              })
            }
          />
          <Button
            type='button'
            size='icon'
            variant='ghost'
            className='size-10 sm:size-9'
            title='Remove row'
            aria-label='Remove equipment row'
            onClick={() => setRows(rows.filter((_, i) => i !== index))}
            disabled={rows.length === 1}
          >
            <Trash2 className='h-4 w-4' />
          </Button>
        </div>
      ))}
    </div>
  )

  const renderMaterialRows = (
    rows: MaterialRow[],
    setRows: (rows: MaterialRow[]) => void
  ) => (
    <div className='space-y-2'>
      <div className='flex items-center justify-between gap-2'>
        <Label className='text-xs'>Materials</Label>
        <Button
          type='button'
          size='sm'
          variant='outline'
          className='min-h-10'
          onClick={() => setRows([...rows, blankMaterial()])}
        >
          <Plus className='mr-1.5 h-4 w-4' />
          Material
        </Button>
      </div>
      {rows.map((row, index) => (
        <div
          key={index}
          className='grid gap-2 sm:grid-cols-[minmax(0,1fr)_96px_96px_36px]'
        >
          <Input
            placeholder='Name'
            value={row.name}
            onChange={(event) =>
              updateMaterial(rows, setRows, index, { name: event.target.value })
            }
          />
          <Input
            type='number'
            min={0}
            placeholder='Qty'
            value={row.qty}
            onChange={(event) =>
              updateMaterial(rows, setRows, index, { qty: event.target.value })
            }
          />
          <Input
            placeholder='Unit'
            value={row.unit}
            onChange={(event) =>
              updateMaterial(rows, setRows, index, { unit: event.target.value })
            }
          />
          <Button
            type='button'
            size='icon'
            variant='ghost'
            className='size-10 sm:size-9'
            title='Remove row'
            aria-label='Remove material row'
            onClick={() => setRows(rows.filter((_, i) => i !== index))}
            disabled={rows.length === 1}
          >
            <Trash2 className='h-4 w-4' />
          </Button>
        </div>
      ))}
    </div>
  )

  const renderRecord = (
    record: DailyReport | SiteDiary,
    kind: 'report' | 'diary'
  ) => {
    const title =
      kind === 'report'
        ? (record as DailyReport).activity?.name ||
          (record as DailyReport).activityId
        : (record as SiteDiary).workDone || 'Site diary'
    const canApprove =
      kind === 'report' ? canApproveDailyReport : canApproveSiteDiary
    const canReject =
      kind === 'report' ? canRejectDailyReport : canRejectSiteDiary

    return (
      <div key={`${kind}-${record.id}`} className='rounded-md border p-3'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <StatusBadge status={record.status} />
              <span className='text-xs text-muted-foreground'>
                {formatDate(record.date)}
              </span>
            </div>
            <p className='mt-2 truncate text-sm font-medium'>{title}</p>
            <p className='mt-1 text-xs text-muted-foreground'>
              {kind === 'report'
                ? `${(record as DailyReport).pctProgress}% progress`
                : `${(record as SiteDiary).workers} workers`}
              {' - '}
              {record.photos.length} photos
            </p>
            {record.clientRequestId && (
              <p className='mt-1 text-xs text-muted-foreground'>
                {record.shift} shift - {record.lineSummary?.totalManHours ?? 0}{' '}
                man-hours
              </p>
            )}
            {record.rejectionReason && (
              <p className='mt-2 text-xs text-red-600'>
                {record.rejectionReason}
              </p>
            )}
          </div>
          {record.status === 'submitted' && (
            <div className='flex flex-wrap gap-2'>
              {kind === 'report' && canApproveDailyReport && (
                <Button
                  size='sm'
                  className='min-h-10 w-full sm:w-auto'
                  onClick={() => approveReport.mutate(record.id)}
                  disabled={approveReport.isPending}
                >
                  <CheckCircle2 className='mr-1.5 h-4 w-4' />
                  Approve
                </Button>
              )}
              {kind === 'report' && canRejectDailyReport && (
                <Button
                  size='sm'
                  variant='outline'
                  className='min-h-10 w-full sm:w-auto'
                  onClick={() =>
                    setRejectTarget({ kind: 'report', id: record.id, title })
                  }
                  disabled={rejectReport.isPending}
                >
                  <XCircle className='mr-1.5 h-4 w-4' />
                  Reject
                </Button>
              )}
              {kind === 'diary' && canApproveSiteDiary && (
                <Button
                  size='sm'
                  className='min-h-10 w-full sm:w-auto'
                  onClick={() => approveDiary.mutate(record.id)}
                  disabled={approveDiary.isPending}
                >
                  <CheckCircle2 className='mr-1.5 h-4 w-4' />
                  Approve
                </Button>
              )}
              {kind === 'diary' && canRejectSiteDiary && (
                <Button
                  size='sm'
                  variant='outline'
                  className='min-h-10 w-full sm:w-auto'
                  onClick={() =>
                    setRejectTarget({ kind: 'diary', id: record.id, title })
                  }
                  disabled={rejectDiary.isPending}
                >
                  <XCircle className='mr-1.5 h-4 w-4' />
                  Reject
                </Button>
              )}
              {!canApprove && !canReject && (
                <Badge variant='outline'>PM approval required</Badge>
              )}
            </div>
          )}
        </div>
        <div className='mt-3'>
          <HistoryPanel
            projectId={projectId}
            entityType={kind === 'report' ? 'daily_report' : 'site_diary'}
            entityId={record.id}
            title={`${kind === 'report' ? 'Daily Report' : 'Site Diary'} History`}
            limit={12}
            showFilters={false}
          />
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='grid gap-3 sm:grid-cols-3'>
        <StatTile
          label='Submitted'
          value={submittedReports.length + submittedDiaries.length}
          icon={ClipboardCheck}
        />
        <StatTile
          label='Approved Today'
          value={approvedToday}
          icon={CheckCircle2}
        />
        <StatTile label='Photos' value={photoCount} icon={ImageIcon} />
      </div>

      {isOffline && (
        <div className='flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'>
          <CloudOff className='h-4 w-4' />
          Offline draft mode
        </div>
      )}

      <Tabs defaultValue='log' className='space-y-4'>
        <TabsList className='grid h-auto w-full grid-cols-4'>
          <TabsTrigger
            value='log'
            className='min-h-11 flex-col gap-1 py-2 text-xs sm:flex-row sm:text-sm'
            data-testid='uat-site-tab-log'
          >
            <ClipboardList className='h-4 w-4' />
            Daily Log
          </TabsTrigger>
          <TabsTrigger
            value='activity'
            className='min-h-11 flex-col gap-1 py-2 text-xs sm:flex-row sm:text-sm'
          >
            <Camera className='h-4 w-4' />
            Activity
          </TabsTrigger>
          <TabsTrigger
            value='diary'
            className='min-h-11 flex-col gap-1 py-2 text-xs sm:flex-row sm:text-sm'
          >
            <CloudSun className='h-4 w-4' />
            Diary
          </TabsTrigger>
          <TabsTrigger
            value='review'
            className='min-h-11 flex-col gap-1 py-2 text-xs sm:flex-row sm:text-sm'
          >
            <ClipboardCheck className='h-4 w-4' />
            Review
          </TabsTrigger>
        </TabsList>

        <TabsContent value='log'>
          <DailyLogPanel
            projectId={projectId}
            activities={activities}
            initialDate={initialDate}
          />
        </TabsContent>

        <TabsContent value='activity'>
          <section className='rounded-md border bg-card p-3 sm:p-4'>
            <div className='mb-4 flex flex-wrap items-center justify-between gap-2'>
              <div>
                <h3 className='text-base font-semibold'>Activity Report</h3>
                <p className='text-xs text-muted-foreground'>
                  {reports.length} activity records
                </p>
              </div>
            </div>

            <div className='grid gap-3 md:grid-cols-3'>
              <div className='md:col-span-2'>
                <Label className='text-xs'>Activity</Label>
                <Select
                  value={dailyActivityId}
                  onValueChange={setDailyActivityId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder='Select activity' />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableActivities.map((activity) => (
                      <SelectItem key={activity.id} value={activity.id}>
                        {activityLabel(activity)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className='text-xs'>Date</Label>
                <Input
                  type='date'
                  value={dailyDate}
                  onChange={(event) => setDailyDate(event.target.value)}
                />
              </div>
              <div>
                <Label className='text-xs'>Shift</Label>
                <Select
                  value={dailyShift}
                  onValueChange={(value) => setDailyShift(value as ShiftValue)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='day'>Day</SelectItem>
                    <SelectItem value='night'>Night</SelectItem>
                    <SelectItem value='swing'>Swing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className='text-xs'>Progress</Label>
                <div className='flex items-center gap-3'>
                  <input
                    type='range'
                    min={0}
                    max={100}
                    value={dailyPct}
                    className='min-h-9 flex-1'
                    aria-label='Activity progress percent'
                    onChange={(event) => setDailyPct(event.target.value)}
                  />
                  <Input
                    type='number'
                    inputMode='numeric'
                    min={0}
                    max={100}
                    value={dailyPct}
                    aria-label='Activity progress percent value'
                    onChange={(event) => setDailyPct(event.target.value)}
                    className='w-20'
                  />
                </div>
              </div>
              <div>
                <Label className='text-xs'>Weather</Label>
                <Input
                  value={dailyWeather}
                  onChange={(event) => setDailyWeather(event.target.value)}
                />
              </div>
              <div className='md:col-span-2'>
                <Label htmlFor='daily-report-photo-input' className='text-xs'>
                  Photos
                </Label>
                <Input
                  id='daily-report-photo-input'
                  className='min-h-10'
                  type='file'
                  accept='image/*,.heic,.heif'
                  multiple
                  capture='environment'
                  aria-describedby='daily-report-photo-status'
                  onChange={(event) =>
                    setDailyPhotoFiles(Array.from(event.target.files ?? []))
                  }
                />
                <p
                  id='daily-report-photo-status'
                  className='mt-1 text-xs text-muted-foreground'
                >
                  {dailyPhotoFiles.length
                    ? `${dailyPhotoFiles.length} selected`
                    : 'No photos selected'}
                </p>
              </div>
            </div>

            <div className='mt-4 grid gap-4 xl:grid-cols-3'>
              <div className='rounded-md bg-muted/30 p-3'>
                <div className='mb-3 flex items-center gap-2 text-sm font-medium'>
                  <Users className='h-4 w-4 text-muted-foreground' />
                  Crew
                </div>
                {renderCrewRows(dailyCrew, setDailyCrew)}
              </div>
              <div className='rounded-md bg-muted/30 p-3'>
                <div className='mb-3 flex items-center gap-2 text-sm font-medium'>
                  <Truck className='h-4 w-4 text-muted-foreground' />
                  Equipment
                </div>
                {renderEquipmentRows(dailyEquipment, setDailyEquipment)}
              </div>
              <div className='rounded-md bg-muted/30 p-3'>
                <div className='mb-3 flex items-center gap-2 text-sm font-medium'>
                  <Package className='h-4 w-4 text-muted-foreground' />
                  Materials
                </div>
                {renderMaterialRows(dailyMaterials, setDailyMaterials)}
              </div>
            </div>

            <div className='mt-4'>
              <Label className='text-xs'>Issue</Label>
              <Textarea
                value={dailyIssue}
                onChange={(event) => setDailyIssue(event.target.value)}
                className='mb-3 min-h-20'
              />
              <Label className='text-xs'>Notes</Label>
              <Textarea
                value={dailyNotes}
                onChange={(event) => setDailyNotes(event.target.value)}
                className='min-h-24'
              />
            </div>

            <div className='mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'>
              <Button
                variant='outline'
                className='min-h-10 w-full sm:w-auto'
                disabled={!canSubmitDailyReport || dailyMutation.isPending}
                onClick={() => runDailyAction('draft')}
              >
                <Save className='mr-1.5 h-4 w-4' />
                Save Draft
              </Button>
              <Button
                className='min-h-10 w-full sm:w-auto'
                disabled={
                  !canSubmitDailyReport ||
                  !dailyActivityId ||
                  isOffline ||
                  dailyMutation.isPending ||
                  uploadPhotos.isPending
                }
                onClick={() => runDailyAction('submitted')}
              >
                <Send className='mr-1.5 h-4 w-4' />
                Submit
              </Button>
            </div>
          </section>
        </TabsContent>

        <TabsContent value='diary'>
          <section className='rounded-md border bg-card p-3 sm:p-4'>
            <div className='mb-4 flex flex-wrap items-center justify-between gap-2'>
              <div>
                <h3 className='text-base font-semibold'>Site Diary</h3>
                <p className='text-xs text-muted-foreground'>
                  {diaries.length} diary records
                </p>
              </div>
            </div>

            <div className='grid gap-3 md:grid-cols-3'>
              <div>
                <Label className='text-xs'>Date</Label>
                <Input
                  type='date'
                  value={diaryDate}
                  onChange={(event) => setDiaryDate(event.target.value)}
                />
              </div>
              <div>
                <Label className='text-xs'>Shift</Label>
                <Select
                  value={diaryShift}
                  onValueChange={(value) => setDiaryShift(value as ShiftValue)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='day'>Day</SelectItem>
                    <SelectItem value='night'>Night</SelectItem>
                    <SelectItem value='swing'>Swing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className='text-xs'>Weather</Label>
                <Input
                  value={diaryWeather}
                  onChange={(event) => setDiaryWeather(event.target.value)}
                />
              </div>
              <div>
                <Label className='text-xs'>Workers</Label>
                <Input
                  type='number'
                  min={0}
                  value={diaryWorkers}
                  onChange={(event) => setDiaryWorkers(event.target.value)}
                />
              </div>
              <div>
                <Label className='text-xs'>Visitors</Label>
                <Input
                  value={diaryVisitors}
                  onChange={(event) => setDiaryVisitors(event.target.value)}
                />
              </div>
              <div className='md:col-span-2'>
                <Label htmlFor='site-diary-photo-input' className='text-xs'>
                  Photos
                </Label>
                <Input
                  id='site-diary-photo-input'
                  className='min-h-10'
                  type='file'
                  accept='image/*,.heic,.heif'
                  multiple
                  capture='environment'
                  aria-describedby='site-diary-photo-status'
                  onChange={(event) =>
                    setDiaryPhotoFiles(Array.from(event.target.files ?? []))
                  }
                />
                <p
                  id='site-diary-photo-status'
                  className='mt-1 text-xs text-muted-foreground'
                >
                  {diaryPhotoFiles.length
                    ? `${diaryPhotoFiles.length} selected`
                    : 'No photos selected'}
                </p>
              </div>
            </div>

            <div className='mt-4 grid gap-3 lg:grid-cols-3'>
              <div>
                <Label className='text-xs'>Work Done</Label>
                <Textarea
                  value={diaryWorkDone}
                  onChange={(event) => setDiaryWorkDone(event.target.value)}
                  className='min-h-24'
                />
              </div>
              <div>
                <Label className='text-xs'>Issues</Label>
                <Textarea
                  value={diaryIssues}
                  onChange={(event) => setDiaryIssues(event.target.value)}
                  className='min-h-24'
                />
              </div>
              <div>
                <Label className='text-xs'>Instructions</Label>
                <Textarea
                  value={diaryInstructions}
                  onChange={(event) => setDiaryInstructions(event.target.value)}
                  className='min-h-24'
                />
              </div>
            </div>

            <div className='mt-4 grid gap-4 xl:grid-cols-3'>
              <div className='rounded-md bg-muted/30 p-3'>
                <div className='mb-3 flex items-center gap-2 text-sm font-medium'>
                  <Users className='h-4 w-4 text-muted-foreground' />
                  Crew
                </div>
                {renderCrewRows(diaryCrew, setDiaryCrew)}
              </div>
              <div className='rounded-md bg-muted/30 p-3'>
                <div className='mb-3 flex items-center gap-2 text-sm font-medium'>
                  <Truck className='h-4 w-4 text-muted-foreground' />
                  Equipment
                </div>
                {renderEquipmentRows(diaryEquipment, setDiaryEquipment)}
              </div>
              <div className='rounded-md bg-muted/30 p-3'>
                <div className='mb-3 flex items-center gap-2 text-sm font-medium'>
                  <Package className='h-4 w-4 text-muted-foreground' />
                  Materials
                </div>
                {renderMaterialRows(diaryMaterials, setDiaryMaterials)}
              </div>
            </div>

            <div className='mt-4'>
              <Label className='text-xs'>Notes</Label>
              <Textarea
                value={diaryNotes}
                onChange={(event) => setDiaryNotes(event.target.value)}
                className='min-h-24'
              />
            </div>

            <div className='mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'>
              <Button
                variant='outline'
                className='min-h-10 w-full sm:w-auto'
                disabled={!canSubmitSiteDiary || diaryMutation.isPending}
                onClick={() => runDiaryAction('draft')}
              >
                <Save className='mr-1.5 h-4 w-4' />
                Save Draft
              </Button>
              <Button
                className='min-h-10 w-full sm:w-auto'
                disabled={
                  !canSubmitSiteDiary ||
                  isOffline ||
                  diaryMutation.isPending ||
                  uploadPhotos.isPending
                }
                onClick={() => runDiaryAction('submitted')}
              >
                <Send className='mr-1.5 h-4 w-4' />
                Submit
              </Button>
            </div>
          </section>
        </TabsContent>

        <TabsContent value='review'>
          <section className='space-y-3'>
            {submittedReports.length === 0 && submittedDiaries.length === 0 ? (
              <EmptyQueue />
            ) : (
              <>
                {submittedReports.map((report) =>
                  renderRecord(report, 'report')
                )}
                {submittedDiaries.map((diary) => renderRecord(diary, 'diary'))}
              </>
            )}
          </section>
        </TabsContent>
      </Tabs>

      <section className='rounded-md border bg-card p-3 sm:p-4'>
        <div className='mb-3 flex items-center justify-between gap-2'>
          <h3 className='text-sm font-semibold'>Recent Site Records</h3>
          <Badge variant='outline'>
            {reports.length + diaries.length} total
          </Badge>
        </div>
        <div className='grid gap-3 lg:grid-cols-2'>
          {[...reports.slice(0, 4), ...diaries.slice(0, 4)]
            .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
            .slice(0, 6)
            .map((record) =>
              renderRecord(record, 'activityId' in record ? 'report' : 'diary')
            )}
        </div>
      </section>

      <Dialog
        open={!!rejectTarget}
        onOpenChange={(open) => {
          if (!open) {
            setRejectTarget(null)
            setRejectReason('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Site Record</DialogTitle>
            <DialogDescription>{rejectTarget?.title}</DialogDescription>
          </DialogHeader>
          <div className='space-y-2'>
            <Label className='text-xs'>Reason</Label>
            <Textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              className='min-h-28'
            />
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              className='min-h-10'
              onClick={() => {
                setRejectTarget(null)
                setRejectReason('')
              }}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              className='min-h-10'
              disabled={
                !rejectReason.trim() ||
                rejectReport.isPending ||
                rejectDiary.isPending
              }
              onClick={() => {
                if (!rejectTarget) return
                if (rejectTarget.kind === 'report') {
                  rejectReport.mutate({
                    reportId: rejectTarget.id,
                    reason: rejectReason.trim(),
                  })
                  return
                }
                rejectDiary.mutate({
                  diaryId: rejectTarget.id,
                  reason: rejectReason.trim(),
                })
              }}
            >
              <XCircle className='mr-1.5 h-4 w-4' />
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
