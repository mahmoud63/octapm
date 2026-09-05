import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import {
  RefreshCw,
  CheckCircle2,
  ChevronDown,
  FileUp,
  MoreHorizontal,
  Upload,
  TrendingUp,
  Link2,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AuditHistoryPanel } from '@/features/audit/components/audit-history-panel'
import { ForecastPanel } from '@/features/forecast/components/forecast-panel'
import { LongLeadTable } from '@/features/long-lead/components/long-lead-table'
import { useLongLeadItems } from '@/features/long-lead/hooks/use-long-lead'
import type { ProjectSetupTarget } from '@/features/projects/data/schema'
import {
  projectSetupReadinessKey,
  useProject,
} from '@/features/projects/hooks/use-projects'
import { EvReport } from '@/features/reports/components/ev-report'
import { RisksTable } from '@/features/risks/components/risks-table'
import type { ProjectSchedule, ScheduleActivity } from '../data/schema'
import { useGenerateSchedule } from '../hooks/use-schedule'
import { ExportButton } from './export-button'
import { GanttChart } from './gantt-chart'
import { GenerationProgress } from './generation-progress'
import { ImportProgressDialog } from './import-progress-dialog'
import { ImportScheduleDialog } from './import-schedule-dialog'
import { PrintReport } from './print-report'
import { PrintReportButton } from './print-report-button'
import { ProgressTab } from './progress-tab'
import { ResourcePlan } from './resource-plan'
import { RevisionHistoryPanel } from './revision-history-panel'
import { ScheduleReviewPanel } from './schedule-review-panel'
import { WbsTree } from './wbs-tree'

interface Props {
  projectId: string
  schedule: ProjectSchedule
  activeTab?: string
  onTabChange?: (value: string) => void
  showTabList?: boolean
  initialTarget?: ProjectSetupTarget
}

const fmtUSD = (n: number) =>
  n
    ? '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
    : '—'

const fmtDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : '—'

const formatLag = (lagDays: number) => {
  if (!lagDays) return ''
  return lagDays > 0 ? `+${lagDays}` : String(lagDays)
}

const formatActivityDependencies = (activity: ScheduleActivity) => {
  if (activity.dependencies?.length) {
    return activity.dependencies
      .map((dependency) => {
        const predecessor = dependency.predecessor
        const ref =
          predecessor?.activityCode ||
          predecessor?.p6ActivityId ||
          dependency.predecessorId.slice(0, 8)
        return `${ref} ${dependency.relationshipType}${formatLag(
          dependency.lagDays
        )}`
      })
      .join(', ')
  }

  return activity.predecessors || '-'
}

const isNearCritical = (a: ScheduleActivity) =>
  !a.isCritical &&
  !a.isMilestone &&
  a.totalFloat != null &&
  a.totalFloat >= 1 &&
  a.totalFloat <= 5

const formatActivityCode = (activity: ScheduleActivity, index = 0) =>
  activity.activityCode ||
  activity.p6ActivityId ||
  `ACT-${String(index + 1).padStart(4, '0')}`

const procurementSeverityRank = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

const procurementRiskClassMap = {
  none: 'bg-emerald-100 text-emerald-800',
  low: 'bg-slate-100 text-slate-700',
  medium: 'bg-amber-100 text-amber-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
}

const projectRiskClassMap = {
  LOW: 'bg-green-100 text-green-800',
  MEDIUM: 'bg-yellow-100 text-yellow-800',
  HIGH: 'bg-orange-100 text-orange-800',
  CRITICAL: 'bg-red-100 text-red-800',
}

const formatProcurementReason = (reason: string | undefined) =>
  reason ? reason.replace(/_/g, ' ') : 'on track'

type ProcurementAlertDisplay = {
  id: string
  item: string
  activityId: string | null
  alertId?: string
  alertStatus?: 'open' | 'acknowledged' | 'resolved'
  procurementRisk?: {
    severity: keyof typeof procurementSeverityRank
    reason: string
    isAtRisk: boolean
    daysAtRisk: number
    needDate: string | null
    orderByDate: string | null
    expectedDeliveryDate: string | null
    impactedActivity: {
      id: string
      name: string
      wbsCode: string | null
      isCritical?: boolean
      totalFloat?: number | null
    } | null
  }
}

function ActivityStatusBadge({
  status,
}: {
  status: ScheduleActivity['status']
}) {
  const map: Record<string, string> = {
    todo: 'bg-slate-100 text-slate-700',
    in_progress: 'bg-blue-100 text-blue-800',
    complete: 'bg-green-100 text-green-800',
    delayed: 'bg-red-100 text-red-800',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? map.todo}`}
    >
      {status.replace('_', ' ')}
    </span>
  )
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string | number
  sub?: string
  color?: string
}) {
  return (
    <div className='rounded-lg border bg-card p-4'>
      <p className='text-xs tracking-wide text-muted-foreground uppercase'>
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold ${color ?? ''}`}>{value}</p>
      {sub && <p className='mt-0.5 text-xs text-muted-foreground'>{sub}</p>}
    </div>
  )
}

export function ScheduleDashboard({
  projectId,
  schedule,
  activeTab,
  onTabChange,
  showTabList = true,
  initialTarget,
}: Props) {
  const canCreateSchedule = useCanPerform('schedule', 'create')
  const canUpdateSchedule = useCanPerform('schedule', 'update')
  const canDeleteSchedule = useCanPerform('schedule', 'delete')
  const canSubmitProgress = useCanPerform(
    'progress',
    'submit',
    'submission.submit'
  )
  const canAcknowledgeProcurementRisk = useCanPerform(
    'procurement',
    'update',
    'alert.acknowledge'
  )
  const canResolveProcurementRisk = useCanPerform(
    'procurement',
    'update',
    'alert.resolve'
  )
  const queryClient = useQueryClient()
  const { data: project } = useProject(projectId)
  const { data: procurementItems = [] } = useLongLeadItems(projectId)
  const { revision, activities } = schedule
  const [nowMs] = useState(() => Date.now())
  const scheduleDataDate =
    schedule.dataDate ||
    revision.dataDate ||
    project?.dataDate ||
    revision.projectSummary?.dataDate ||
    null
  const [regenLabel, setRegenLabel] = useState('')
  const [isImportScheduleOpen, setImportScheduleOpen] = useState(false)
  const [isImportProgressOpen, setImportProgressOpen] = useState(false)
  const [showPrintReport, setShowPrintReport] = useState(false)
  const {
    trigger,
    isPending: regenPending,
    currentStep: regenStep,
    error: regenError,
    job,
  } = useGenerateSchedule(projectId)

  const recalcCpmMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/projects/${projectId}/import/recalculate-cpm`),
    onSuccess: async (response) => {
      const payload = response.data.data as {
        recalculated?: number
        criticalActivities?: number
      }
      await refreshScheduleData()
      toast.success(
        `CPM recalculated (${payload.recalculated ?? 0} activities, ${payload.criticalActivities ?? 0} critical)`
      )
    },
    onError: () => toast.error('Failed to recalculate CPM'),
  })

  const reseedMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/projects/${projectId}/import/seed-linked-modules`),
    onSuccess: async (response) => {
      const payload = response.data.data as {
        costSeeded?: number
        longLeadSeeded?: number
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['cost-summary', projectId],
        }),
        queryClient.invalidateQueries({ queryKey: ['long-lead', projectId] }),
      ])
      toast.success(
        `Linked modules seeded (cost: ${payload.costSeeded ?? 0}, long-lead: ${payload.longLeadSeeded ?? 0})`
      )
    },
    onError: () => toast.error('Failed to seed linked modules'),
  })

  const procurementAlertMutation = useMutation({
    mutationFn: ({
      alertId,
      action,
    }: {
      alertId: string
      action: 'acknowledge' | 'resolve'
    }) =>
      apiClient.patch(
        `/projects/${projectId}/procurement/lead-time-alerts/${alertId}/${action}`,
        {}
      ),
    onSuccess: async (_response, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['schedule', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['long-lead', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['health', projectId] }),
      ])
      toast.success(
        variables.action === 'acknowledge'
          ? 'Procurement risk acknowledged'
          : 'Procurement risk resolved'
      )
    },
    onError: () => toast.error('Failed to update procurement risk'),
  })

  const critActs = activities.filter((a) => a.isCritical && !a.isMilestone)
  const nearCriticalActs = activities.filter((a) => isNearCritical(a))
  const milestones = activities.filter((a) => a.isMilestone)
  const milestoneCards = revision.milestones || milestones
  const totalBudget = revision.totalBudget
  const projectRiskActivities = useMemo(
    () =>
      activities.filter(
        (activity) => (activity.projectRiskSummary?.count ?? 0) > 0
      ),
    [activities]
  )
  const overdueProjectRisks = useMemo(
    () =>
      activities.reduce(
        (sum, activity) =>
          sum + (activity.projectRiskSummary?.overdueCount ?? 0),
        0
      ),
    [activities]
  )
  const scheduleProcurementAlerts = useMemo<ProcurementAlertDisplay[]>(
    () =>
      activities.flatMap((activity) =>
        (activity.procurementRiskSummary?.items ?? [])
          .filter(
            (item) =>
              procurementSeverityRank[item.severity] >=
              procurementSeverityRank.medium
          )
          .map((item) => ({
            id: item.id,
            item: item.item,
            activityId: activity.id,
            alertId: item.id,
            alertStatus: item.status,
            procurementRisk: {
              severity: item.severity,
              reason: item.reason,
              isAtRisk: true,
              daysAtRisk: item.daysAtRisk,
              needDate: item.needDate,
              orderByDate: item.orderByDate,
              expectedDeliveryDate: item.expectedDeliveryDate,
              impactedActivity: {
                id: activity.id,
                name: activity.name,
                wbsCode: activity.wbsCode,
                isCritical: activity.isCritical,
                totalFloat: activity.totalFloat,
              },
            },
          }))
      ),
    [activities]
  )
  const procurementAlerts = useMemo<ProcurementAlertDisplay[]>(
    () =>
      [
        ...procurementItems.filter((item) => item.procurementRisk?.isAtRisk),
        ...scheduleProcurementAlerts,
      ].sort((a, b) => {
        const aRisk = a.procurementRisk
        const bRisk = b.procurementRisk
        const severityDelta =
          procurementSeverityRank[bRisk?.severity ?? 'none'] -
          procurementSeverityRank[aRisk?.severity ?? 'none']
        if (severityDelta !== 0) return severityDelta
        return (bRisk?.daysAtRisk ?? 0) - (aRisk?.daysAtRisk ?? 0)
      }),
    [procurementItems, scheduleProcurementAlerts]
  )
  const procurementRiskByActivity = useMemo(() => {
    const riskByActivity = new Map<
      string,
      NonNullable<ProcurementAlertDisplay['procurementRisk']>
    >()

    procurementAlerts.forEach((item) => {
      const risk = item.procurementRisk
      if (!item.activityId || !risk?.isAtRisk) return

      const existing = riskByActivity.get(item.activityId)
      if (
        !existing ||
        procurementSeverityRank[risk.severity] >
          procurementSeverityRank[existing.severity] ||
        (procurementSeverityRank[risk.severity] ===
          procurementSeverityRank[existing.severity] &&
          risk.daysAtRisk > existing.daysAtRisk)
      ) {
        riskByActivity.set(item.activityId, risk)
      }
    })

    return riskByActivity
  }, [procurementAlerts])
  const todayWorkingDay = useMemo(() => {
    const startDate = revision.projectSummary?.startDate
    if (!startDate) return 0

    const startMs = new Date(startDate).getTime()
    if (Number.isNaN(startMs)) return 0

    const dataDateMs = scheduleDataDate
      ? new Date(scheduleDataDate).getTime()
      : nowMs
    const effectiveNowMs = Number.isNaN(dataDateMs) ? nowMs : dataDateMs
    const calDays = Math.floor(
      (effectiveNowMs - startMs) / (1000 * 60 * 60 * 24)
    )
    return Math.max(0, Math.floor((calDays * 5) / 7))
  }, [revision.projectSummary?.startDate, scheduleDataDate, nowMs])

  const slippageOf = (a: ScheduleActivity): number => {
    if (a.pctComplete >= 100) return 0
    if (a.earlyFinish == null) return 0
    if (a.earlyFinish >= todayWorkingDay) return 0
    return todayWorkingDay - a.earlyFinish
  }

  const nextMilestone = useMemo(() => {
    const upcoming = milestoneCards
      .filter((milestone) => {
        const activity = activities.find(
          (item) => item.isMilestone && item.name === milestone.name
        )
        return (
          activity &&
          activity.pctComplete < 100 &&
          (milestone.day ?? 0) >= todayWorkingDay
        )
      })
      .sort((a, b) => (a.day ?? 0) - (b.day ?? 0))

    return upcoming[0] ?? null
  }, [milestoneCards, activities, todayWorkingDay])

  const handleRegen = async (file: File) => {
    try {
      await trigger({ file, label: regenLabel })
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? 'Regeneration failed'
      toast.error(msg)
    }
  }

  const refreshScheduleData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['schedule', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['activities', projectId] }),
      queryClient.invalidateQueries({
        queryKey: ['schedule-revisions', projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: projectSetupReadinessKey(projectId),
      }),
    ])
  }

  const handleActivityUpdate = async (
    id: string,
    patch: Partial<ScheduleActivity>
  ) => {
    await apiClient.patch(`/projects/${projectId}/activities/${id}`, patch)
    await refreshScheduleData()
  }

  const handleActivityDelete = async (id: string) => {
    await apiClient.delete(`/projects/${projectId}/activities/${id}`)
    await refreshScheduleData()
  }

  const fallbackStepText = (regenStep || '').toLowerCase()
  const fallbackCurrentStep =
    (fallbackStepText.includes('pass 3') && 2) ||
    (fallbackStepText.includes('pass 2') && 1) ||
    0
  const fallbackProgress =
    (fallbackStepText.includes('pass 3') && 88) ||
    (fallbackStepText.includes('pass 2') && 55) ||
    20

  const defaultSteps = [
    {
      label: 'Pass 1: Structuring BOQ',
      description: 'Parsing BOQ and organizing rows',
    },
    {
      label: 'Pass 2: Generating CPM Schedule',
      description: 'Creating activities and dependencies',
    },
    {
      label: 'Pass 3: Allocating Resources',
      description: 'Assigning labor, equipment, and materials',
    },
  ]

  useEffect(() => {
    if (regenError) toast.error(regenError)
  }, [regenError])

  useEffect(() => {
    const onAfterPrint = () => setShowPrintReport(false)
    window.addEventListener('afterprint', onAfterPrint)
    return () => window.removeEventListener('afterprint', onAfterPrint)
  }, [])

  const tabsProps =
    activeTab !== undefined
      ? { value: activeTab, onValueChange: onTabChange }
      : { defaultValue: 'gantt' }
  const showUpdateScheduleActions = canCreateSchedule || canSubmitProgress

  return (
    <div className='space-y-6'>
      {/* Header: stats + action toolbar */}
      <div className='flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between'>
        {/* Stat cards */}
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-6'>
          <StatCard label='Total Activities' value={revision.activityCount} />
          <StatCard
            label='Critical Path'
            value={revision.criticalCount}
            color='text-red-600'
            sub='activities'
          />
          <StatCard
            label='Milestones'
            value={milestones.length}
            color='text-purple-600'
          />
          <StatCard
            label='Total Budget'
            value={fmtUSD(totalBudget)}
            color='text-amber-600'
          />
          <StatCard
            label='Proc Risk'
            value={procurementAlerts.length}
            color={
              procurementAlerts.length > 0
                ? 'text-orange-600'
                : 'text-green-600'
            }
            sub='alerts'
          />
          <StatCard
            label='Project Risk'
            value={projectRiskActivities.length}
            color={overdueProjectRisks > 0 ? 'text-red-600' : 'text-amber-600'}
            sub={`${overdueProjectRisks} overdue`}
          />
        </div>

        {/* Action toolbar */}
        <div className='flex flex-wrap items-center gap-2'>
          {/* Export actions */}
          <ExportButton projectId={projectId} />
          <PrintReportButton
            onClick={() => {
              setShowPrintReport(true)
              window.setTimeout(() => window.print(), 250)
            }}
          />

          <div className='h-6 w-px bg-border' />

          {/* Update Schedule dropdown */}
          {showUpdateScheduleActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline' size='sm' disabled={regenPending}>
                  <FileUp className='mr-1.5 h-4 w-4' />
                  Update Schedule
                  <ChevronDown className='ml-1 h-3.5 w-3.5 opacity-60' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-64 p-2'>
                <p className='mb-1.5 px-1 text-xs font-medium text-muted-foreground'>
                  Revision label (optional)
                </p>
                <Input
                  value={regenLabel}
                  onChange={(e) => setRegenLabel(e.target.value)}
                  placeholder='e.g. Rev 3 — post-RFI'
                  disabled={regenPending || !canCreateSchedule}
                  className='mb-1 h-8 text-sm'
                  onClick={(e) => e.stopPropagation()}
                />
                <DropdownMenuSeparator className='my-1.5' />
                <DropdownMenuItem asChild>
                  <label
                    htmlFor={canCreateSchedule ? 'regen-file' : undefined}
                    className={cn(
                      'flex cursor-pointer items-center gap-2',
                      (regenPending || !canCreateSchedule) &&
                        'pointer-events-none opacity-50'
                    )}
                  >
                    <RefreshCw
                      className={cn('h-4 w-4', regenPending && 'animate-spin')}
                    />
                    {regenPending
                      ? regenStep || 'Regenerating…'
                      : 'Regenerate from BOQ file'}
                  </label>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setImportScheduleOpen(true)}
                  disabled={regenPending || !canCreateSchedule}
                >
                  <Upload className='h-4 w-4' />
                  Import Schedule (P6/MSP)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setImportProgressOpen(true)}
                  disabled={regenPending || !canSubmitProgress}
                >
                  <TrendingUp className='h-4 w-4' />
                  Import Progress
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Maintenance / admin actions */}
          {canUpdateSchedule && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='outline'
                  size='icon'
                  className='size-8'
                  disabled={regenPending}
                >
                  <MoreHorizontal className='h-4 w-4' />
                  <span className='sr-only'>More actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-52'>
                <DropdownMenuLabel className='text-xs text-muted-foreground'>
                  Schedule Maintenance
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => recalcCpmMutation.mutate()}
                  disabled={regenPending || recalcCpmMutation.isPending}
                >
                  <RefreshCw
                    className={cn(
                      'h-4 w-4',
                      recalcCpmMutation.isPending && 'animate-spin'
                    )}
                  />
                  {recalcCpmMutation.isPending
                    ? 'Recalculating...'
                    : 'Recalculate CPM'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => reseedMutation.mutate()}
                  disabled={regenPending || reseedMutation.isPending}
                >
                  <Link2 className='h-4 w-4' />
                  {reseedMutation.isPending
                    ? 'Seeding...'
                    : 'Re-seed Linked Modules'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {canCreateSchedule && (
          <input
            id='regen-file'
            type='file'
            accept='.xlsx,.xls,.csv'
            className='hidden'
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleRegen(f)
              e.target.value = ''
            }}
          />
        )}
      </div>

      {regenPending && (
        <GenerationProgress
          currentStep={job?.currentStep ?? fallbackCurrentStep}
          totalSteps={job?.totalSteps ?? 3}
          steps={job?.steps ?? defaultSteps}
          progress={job?.progress ?? fallbackProgress}
          step={job?.step ?? regenStep ?? 'Processing...'}
        />
      )}

      <ScheduleReviewPanel projectId={projectId} revision={revision} />
      <AuditHistoryPanel
        projectId={projectId}
        entityType='schedule_revision'
        entityId={revision.id}
        title='Schedule Status History'
      />

      {/* Project summary from AI */}
      {revision.projectSummary && (
        <div className='rounded-lg border bg-muted/30 p-4 text-sm'>
          <div className='flex flex-wrap gap-6 text-muted-foreground'>
            <span>
              Start:{' '}
              <strong className='text-foreground'>
                {revision.projectSummary.startDate || '—'}
              </strong>
            </span>
            <span>
              End:{' '}
              <strong className='text-foreground'>
                {revision.projectSummary.endDate || '—'}
              </strong>
            </span>
            <span>
              Duration:{' '}
              <strong className='text-foreground'>
                {revision.projectSummary.totalDuration || '—'}
              </strong>
            </span>
            <span>
              Type:{' '}
              <strong className='text-foreground'>
                {revision.projectSummary.type || '—'}
              </strong>
            </span>
          </div>
        </div>
      )}

      {procurementAlerts.length > 0 && (
        <div className='rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-900/40 dark:bg-orange-950/20 dark:text-orange-200'>
          <div className='flex items-start gap-2'>
            <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
            <div className='min-w-0 space-y-1'>
              <p className='font-semibold'>
                {procurementAlerts.length} procurement schedule risk
                {procurementAlerts.length === 1 ? '' : 's'}
              </p>
              <div className='flex flex-wrap gap-2'>
                {procurementAlerts.slice(0, 3).map((item) => {
                  const risk = item.procurementRisk
                  const activity = risk?.impactedActivity
                  return (
                    <span
                      key={item.id}
                      className='inline-flex max-w-full items-center gap-1 rounded-full border border-orange-300 bg-background/70 px-2 py-0.5 text-xs'
                    >
                      <Badge
                        className={
                          procurementRiskClassMap[risk?.severity ?? 'none']
                        }
                      >
                        {risk?.severity ?? 'none'}
                      </Badge>
                      <span className='truncate'>
                        {item.item}
                        {activity
                          ? ` -> ${activity.wbsCode ? `${activity.wbsCode} ` : ''}${activity.name}`
                          : ''}
                      </span>
                      {item.alertId &&
                        item.alertStatus === 'open' &&
                        canAcknowledgeProcurementRisk && (
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            className='h-6 px-2 text-xs'
                            disabled={procurementAlertMutation.isPending}
                            onClick={() =>
                              procurementAlertMutation.mutate({
                                alertId: item.alertId as string,
                                action: 'acknowledge',
                              })
                            }
                          >
                            Ack
                          </Button>
                        )}
                      {item.alertId &&
                        item.alertStatus !== 'resolved' &&
                        canResolveProcurementRisk && (
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            className='h-6 px-2 text-xs'
                            disabled={procurementAlertMutation.isPending}
                            onClick={() =>
                              procurementAlertMutation.mutate({
                                alertId: item.alertId as string,
                                action: 'resolve',
                              })
                            }
                          >
                            Resolve
                          </Button>
                        )}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {projectRiskActivities.length > 0 && (
        <div className='rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200'>
          <div className='flex items-start gap-2'>
            <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
            <div className='min-w-0 space-y-1'>
              <p className='font-semibold'>
                {projectRiskActivities.length} activity-linked project risk
                {projectRiskActivities.length === 1 ? '' : 's'}
              </p>
              <div className='flex flex-wrap gap-2'>
                {projectRiskActivities.slice(0, 3).map((activity) => {
                  const risk = activity.projectRiskSummary
                  const top = risk?.items?.[0]
                  return (
                    <span
                      key={activity.id}
                      className='inline-flex max-w-full items-center gap-1 rounded-full border border-amber-300 bg-background/70 px-2 py-0.5 text-xs'
                    >
                      {top && (
                        <Badge className={projectRiskClassMap[top.severity]}>
                          {top.severity}
                        </Badge>
                      )}
                      <span className='truncate'>
                        {top?.ref || 'Risk'} - {formatActivityCode(activity)}
                      </span>
                      {risk?.overdueCount ? (
                        <Badge className='bg-red-100 text-red-800'>
                          {risk.overdueCount} overdue
                        </Badge>
                      ) : null}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs {...tabsProps}>
        {showTabList && (
          <TabsList className='flex-wrap'>
            <TabsTrigger value='gantt'>Gantt</TabsTrigger>
            <TabsTrigger value='activities'>
              Activities ({activities.length})
            </TabsTrigger>
            <TabsTrigger value='progress'>Progress</TabsTrigger>
            <TabsTrigger value='critical'>
              Critical Path ({critActs.length})
            </TabsTrigger>
            <TabsTrigger value='ev'>Earned Value</TabsTrigger>
            <TabsTrigger value='forecast'>Forecast</TabsTrigger>
            <TabsTrigger value='milestones'>
              Milestones ({milestones.length})
            </TabsTrigger>
            <TabsTrigger value='resources'>Resources</TabsTrigger>
            <TabsTrigger value='risks'>Risks</TabsTrigger>
            <TabsTrigger value='longLead'>Long Lead</TabsTrigger>
            {(revision.wbs || []).length > 0 && (
              <TabsTrigger value='wbs'>WBS</TabsTrigger>
            )}
            <TabsTrigger value='revisions'>Revisions</TabsTrigger>
          </TabsList>
        )}

        {/* Gantt tab */}
        <TabsContent value='gantt' className='mt-4'>
          <GanttChart
            activities={activities}
            projectStartDate={
              project?.startDate || revision.projectSummary?.startDate || null
            }
            projectEndDate={
              project?.endDate || revision.projectSummary?.endDate || null
            }
            dataDate={scheduleDataDate}
            onActivityUpdate={
              canUpdateSchedule ? handleActivityUpdate : undefined
            }
            onActivityDelete={
              canDeleteSchedule ? handleActivityDelete : undefined
            }
          />
        </TabsContent>

        {/* Activities tab */}
        <TabsContent value='activities' className='mt-4'>
          <div className='overflow-x-auto rounded-md border'>
            <table className='w-full text-sm whitespace-nowrap'>
              <thead className='border-b bg-muted/50'>
                <tr>
                  <th className='p-2 text-left font-medium'>Batch</th>
                  <th className='p-2 text-left font-medium'>Activity ID</th>
                  <th className='p-2 text-left font-medium'>WBS</th>
                  <th className='p-2 text-left font-medium'>Activity</th>
                  <th className='p-2 text-left font-medium'>Proc Risk</th>
                  <th className='p-2 text-left font-medium'>Risk</th>
                  <th className='p-2 text-left font-medium'>Phase</th>
                  <th className='p-2 text-right font-medium'>Duration</th>
                  <th className='p-2 text-right font-medium'>ES</th>
                  <th className='p-2 text-right font-medium'>EF</th>
                  <th className='p-2 text-right font-medium'>LS</th>
                  <th className='p-2 text-right font-medium'>LF</th>
                  <th className='p-2 text-right font-medium'>Float</th>
                  <th className='p-2 text-left font-medium'>Predecessors</th>
                  <th className='p-2 text-right font-medium'>Budget</th>
                  <th className='p-2 text-center font-medium'>Status</th>
                  <th className='p-2 text-center font-medium'>%</th>
                  <th className='p-2 text-right font-medium'>Act. Start</th>
                  <th className='p-2 text-right font-medium'>Act. Finish</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((a, index) => (
                  <tr
                    key={a.id}
                    className={[
                      'border-b hover:bg-muted/25',
                      a.isMilestone ? 'bg-purple-50 dark:bg-purple-950/20' : '',
                      a.isCritical && !a.isMilestone
                        ? 'bg-red-50 dark:bg-red-950/20'
                        : '',
                    ].join(' ')}
                  >
                    <td className='p-2 text-xs font-semibold text-muted-foreground'>
                      {a.batchId || '—'}
                    </td>
                    <td className='p-2 font-mono text-xs'>
                      {formatActivityCode(a, index)}
                    </td>
                    <td className='p-2 font-mono text-xs text-muted-foreground'>
                      {a.wbsCode || '—'}
                    </td>
                    <td className='max-w-50 p-2'>
                      <div className='flex items-center gap-1.5'>
                        {a.isMilestone && (
                          <span className='text-purple-600'>◆</span>
                        )}
                        {a.isCritical && !a.isMilestone && (
                          <span className='h-1.5 w-1.5 rounded-full bg-red-500' />
                        )}
                        <span className='truncate font-medium'>{a.name}</span>
                      </div>
                    </td>
                    <td
                      className='p-2'
                      title={formatProcurementReason(
                        procurementRiskByActivity.get(a.id)?.reason
                      )}
                    >
                      {procurementRiskByActivity.get(a.id) ? (
                        <Badge
                          className={
                            procurementRiskClassMap[
                              procurementRiskByActivity.get(a.id)?.severity ??
                                'none'
                            ]
                          }
                        >
                          {procurementRiskByActivity.get(a.id)?.severity}
                        </Badge>
                      ) : (
                        <span className='text-xs text-muted-foreground'>-</span>
                      )}
                    </td>
                    <td
                      className='p-2'
                      title={a.projectRiskSummary?.items?.[0]?.description}
                    >
                      {a.projectRiskSummary ? (
                        <div className='flex items-center gap-1'>
                          <Badge
                            className={
                              projectRiskClassMap[
                                a.projectRiskSummary.highestSeverity
                              ]
                            }
                          >
                            {a.projectRiskSummary.highestSeverity}
                          </Badge>
                          {a.projectRiskSummary.overdueCount > 0 && (
                            <Badge className='bg-red-100 text-red-800'>
                              {a.projectRiskSummary.overdueCount}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className='text-xs text-muted-foreground'>-</span>
                      )}
                    </td>
                    <td className='p-2 text-xs text-muted-foreground'>
                      {a.category || '—'}
                    </td>
                    <td className='p-2 text-right text-xs'>
                      {a.isMilestone ? '—' : `${a.duration}d`}
                    </td>
                    <td
                      className='p-2 text-right font-mono text-xs'
                      title={fmtDate(a.earlyStartDate)}
                    >
                      {a.earlyStart ?? '—'}
                    </td>
                    <td
                      className='p-2 text-right font-mono text-xs'
                      title={fmtDate(a.earlyFinishDate)}
                    >
                      {a.earlyFinish ?? '—'}
                    </td>
                    <td
                      className='p-2 text-right font-mono text-xs'
                      title={fmtDate(a.lateStartDate)}
                    >
                      {a.lateStart ?? '—'}
                    </td>
                    <td
                      className='p-2 text-right font-mono text-xs'
                      title={fmtDate(a.lateFinishDate)}
                    >
                      {a.lateFinish ?? '—'}
                    </td>
                    <td className='p-2 text-right text-xs'>
                      {a.isMilestone ? (
                        <span className='text-purple-600'>MS</span>
                      ) : a.isCritical ? (
                        <span className='font-semibold text-red-600'>0d</span>
                      ) : isNearCritical(a) ? (
                        <span className='font-semibold text-orange-600'>
                          {a.totalFloat}d ⚠
                        </span>
                      ) : a.totalFloat != null ? (
                        `${a.totalFloat}d`
                      ) : (
                        '—'
                      )}
                    </td>
                    <td
                      className='max-w-35 truncate p-2 text-xs text-muted-foreground'
                      title={formatActivityDependencies(a)}
                    >
                      {formatActivityDependencies(a)}
                    </td>
                    <td className='p-2 text-right text-xs'>
                      {a.budget ? fmtUSD(a.budget) : '—'}
                    </td>
                    <td className='p-2 text-center'>
                      <ActivityStatusBadge status={a.status} />
                    </td>
                    <td className='p-2 text-right font-mono text-xs'>
                      {a.pctComplete}%
                    </td>
                    <td className='p-2 text-right text-xs'>
                      {fmtDate(a.actualStart)}
                    </td>
                    <td className='p-2 text-right text-xs'>
                      {fmtDate(a.actualFinish)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value='progress' className='mt-4'>
          <ProgressTab activities={activities} projectId={projectId} />
        </TabsContent>

        <TabsContent value='ev' className='mt-4'>
          <EvReport projectId={projectId} />
        </TabsContent>

        <TabsContent value='forecast' className='mt-4'>
          <ForecastPanel projectId={projectId} />
        </TabsContent>

        {/* Critical path tab */}
        <TabsContent value='critical' className='mt-4'>
          {nearCriticalActs.length > 0 && (
            <div className='mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800'>
              <p className='font-semibold'>
                {nearCriticalActs.length} near-critical{' '}
                {nearCriticalActs.length === 1 ? 'activity' : 'activities'} (TF
                ≤ 5d)
              </p>
              <p className='mt-1 text-xs'>
                These activities may become critical if delayed further:
              </p>
              <ul className='mt-1 list-inside list-disc text-xs'>
                {nearCriticalActs.map((a) => (
                  <li key={a.id}>
                    {a.name} — TF: {a.totalFloat ?? '—'}d
                  </li>
                ))}
              </ul>
            </div>
          )}

          {critActs.length === 0 ? (
            <p className='py-8 text-center text-muted-foreground'>
              No critical path activities.
            </p>
          ) : (
            <div className='space-y-2'>
              {critActs.map((a, i) => {
                const slip = slippageOf(a)

                return (
                  <div
                    key={a.id}
                    className='flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/40 dark:bg-red-950/20'
                  >
                    <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white'>
                      {i + 1}
                    </span>
                    <div className='min-w-0 flex-1'>
                      <p className='truncate font-medium'>{a.name}</p>
                      <p className='text-xs text-muted-foreground'>
                        {formatActivityCode(a)} · WBS {a.wbsCode || '-'} ·{' '}
                        {a.category} · {a.duration}d · d{a.earlyStart}→d
                        {a.earlyFinish}
                      </p>
                      <div className='mt-1 flex items-center gap-2'>
                        <div className='h-1.5 flex-1 rounded-full bg-red-200'>
                          <div
                            className='h-1.5 rounded-full bg-red-600'
                            style={{ width: `${a.pctComplete}%` }}
                          />
                        </div>
                        <span className='font-mono text-xs text-red-700'>
                          {a.pctComplete}%
                        </span>
                      </div>
                    </div>
                    <div className='flex flex-col items-end gap-1'>
                      <Badge variant='destructive' className='text-xs'>
                        CRITICAL
                      </Badge>
                      {slip > 0 && (
                        <span className='rounded-full bg-red-800 px-2 py-0.5 text-xs font-semibold text-white'>
                          {slip}d behind
                        </span>
                      )}
                      {slip === 0 && a.pctComplete < 100 && (
                        <span className='rounded-full bg-green-600 px-2 py-0.5 text-xs text-white'>
                          on schedule
                        </span>
                      )}
                      {a.pctComplete >= 100 && (
                        <span className='rounded-full bg-slate-500 px-2 py-0.5 text-xs text-white'>
                          complete
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* Milestones tab */}
        <TabsContent value='milestones' className='mt-4'>
          {milestones.length === 0 ? (
            <p className='py-8 text-center text-muted-foreground'>
              No milestones.
            </p>
          ) : (
            <>
              {nextMilestone && (
                <div className='mb-4 rounded-lg border border-purple-300 bg-purple-50 p-3 dark:border-purple-900/40 dark:bg-purple-950/20'>
                  <p className='text-sm font-semibold text-purple-800 dark:text-purple-300'>
                    ◆ Next milestone: {nextMilestone.name}
                  </p>
                  <p className='mt-0.5 text-xs text-purple-700 dark:text-purple-400'>
                    Day {nextMilestone.day} ·{' '}
                    {(nextMilestone.day ?? 0) - todayWorkingDay} working days
                    away
                    {nextMilestone.phase ? ` · ${nextMilestone.phase}` : ''}
                  </p>
                </div>
              )}

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                {milestoneCards.map(
                  (
                    m: {
                      name: string
                      day?: number
                      description?: string
                      phase?: string
                      critical?: boolean
                    },
                    i: number
                  ) => {
                    const activity = activities.find(
                      (item) => item.isMilestone && item.name === m.name
                    )
                    const isComplete = Boolean(
                      activity && activity.pctComplete >= 100
                    )
                    const isPast = (m.day ?? 0) < todayWorkingDay
                    const isOverdue = isPast && !isComplete
                    const daysDiff = (m.day ?? 0) - todayWorkingDay

                    return (
                      <div
                        key={i}
                        className={[
                          'relative rounded-lg border p-4',
                          isComplete
                            ? 'border-green-300 bg-green-50 dark:border-green-900/40 dark:bg-green-950/20'
                            : isOverdue
                              ? 'border-red-300 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20'
                              : '',
                        ].join(' ')}
                      >
                        {isComplete && (
                          <div className='absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-xs text-white'>
                            ✓
                          </div>
                        )}
                        {isOverdue && (
                          <div className='absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white'>
                            !
                          </div>
                        )}

                        <div className='flex items-start gap-2'>
                          <span
                            className={`font-semibold ${isOverdue ? 'text-red-600' : 'text-purple-600'}`}
                          >
                            ◆
                          </span>
                          <div className='min-w-0 flex-1'>
                            <p className='truncate font-medium'>{m.name}</p>
                            <p className='text-xs text-muted-foreground'>
                              {m.phase || '—'} · Day {m.day ?? '—'}
                            </p>
                            {m.description && (
                              <p className='mt-1 text-xs text-muted-foreground'>
                                {m.description}
                              </p>
                            )}

                            <p className='mt-2 text-xs font-medium'>
                              {isComplete ? (
                                <span className='text-green-600'>Achieved</span>
                              ) : isOverdue ? (
                                <span className='text-red-600'>
                                  Overdue by {todayWorkingDay - (m.day ?? 0)}d
                                </span>
                              ) : daysDiff <= 14 ? (
                                <span className='text-amber-600'>
                                  Due in {daysDiff}d
                                </span>
                              ) : (
                                <span className='text-muted-foreground'>
                                  In {daysDiff}d
                                </span>
                              )}
                            </p>
                          </div>
                        </div>

                        {m.critical && !isComplete && (
                          <Badge variant='destructive' className='mt-2 text-xs'>
                            CP
                          </Badge>
                        )}
                      </div>
                    )
                  }
                )}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value='resources' className='mt-4'>
          <ResourcePlan projectId={projectId} />
        </TabsContent>

        {/* Risks tab */}
        <TabsContent value='risks' className='mt-4'>
          <RisksTable projectId={projectId} initialTarget={initialTarget} />
        </TabsContent>

        {/* Long Lead tab */}
        <TabsContent value='longLead' className='mt-4'>
          <LongLeadTable projectId={projectId} activities={activities} />
        </TabsContent>

        {/* WBS tab */}
        {(revision.wbs || []).length > 0 && (
          <TabsContent value='wbs' className='mt-4'>
            <WbsTree nodes={revision.wbs || []} />
          </TabsContent>
        )}

        <TabsContent value='revisions' className='mt-4'>
          <RevisionHistoryPanel
            projectId={projectId}
            currentRevision={revision}
            currentActivities={activities}
          />
        </TabsContent>
      </Tabs>

      {/* Generation metadata */}
      <p className='text-xs text-muted-foreground'>
        <CheckCircle2 className='mr-1 inline h-3 w-3 text-green-500' />
        Schedule revision · {revision.label} · {revision.status} ·{' '}
        {new Date(revision.createdAt).toLocaleString()}
      </p>

      <ImportScheduleDialog
        projectId={projectId}
        open={isImportScheduleOpen}
        onOpenChange={setImportScheduleOpen}
      />
      <ImportProgressDialog
        projectId={projectId}
        open={isImportProgressOpen}
        onOpenChange={setImportProgressOpen}
      />
      {showPrintReport && (
        <PrintReport
          projectName={project?.name || 'Project'}
          projectStartDate={project?.startDate || null}
          activities={activities}
        />
      )}
    </div>
  )
}
