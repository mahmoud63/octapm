import type { ComponentProps, ComponentType, ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { apiClient } from '@/services/api/client'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ClipboardCheck,
  Clock3,
  FileWarning,
  FolderKanban,
  PackageSearch,
  Plus,
  ShieldCheck,
  TrendingDown,
  WalletCards,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Main } from '@/components/layout/main'

type DashboardTarget = {
  projectId: string | null
  module: string
  child?: string
  status?: string
  source?: string
  recordId?: string
}

type KpiSourceRule = {
  source: string
  formula: string
  officialOnly: boolean
}

type DashboardKpi = {
  key: string
  label: string
  value: number | null
  unit?: string
  detail: string
  sourceRule: KpiSourceRule
  sourceStatus: string
  cutoffDate: string | null
  generatedAt: string
  target: DashboardTarget
}

type PendingReviewMetric = {
  key: string
  label: string
  count: number
  detail: string
  source: string
  sourceStatus: string
  excludedFromOfficialKpis: boolean
  cutoffDate: string | null
  target: DashboardTarget
}

type HealthDimension = {
  key: string
  label: string
  score: number | null
  detail: string
  count: number
  sourceRule?: KpiSourceRule
  cutoffDate?: string | null
  target?: DashboardTarget
}

type WorkflowItem = {
  id: string
  projectId: string
  projectName: string
  title: string
  meta: string
  severity: string
  dueDate: string | null
  target: DashboardTarget
}

type WorkflowQueue = {
  key: string
  label: string
  count: number
  description: string
  items: WorkflowItem[]
  defaultTarget: DashboardTarget
}

type ProjectHealth = {
  id: string
  name: string
  status: string
  currency: string
  contractValue: number
  overallScore: number
  weakestDimension: {
    key: string
    label: string
    score: number
  }
  delayedActivities: number
  workflowActions: number
  procurementRisks: number
  overdueNcrRfi: number
  target: DashboardTarget
}

type WorkspaceDashboard = {
  generatedAt: string
  dataFreshness?: {
    generatedAt: string
    cutoffDate: string | null
    sourceUpdatedAt: string | null
    note: string
  }
  summary: {
    totalProjects: number
    activeProjects: number
    totalContractValue: number
    portfolioHealthScore: number | null
    delayedActivities: number
    criticalActivities: number
    approvalQueueCount: number
    procurementAtRisk: number
    overdueNcrRfi: number
  }
  officialKpis?: DashboardKpi[]
  pendingReview?: {
    total: number
    metrics: PendingReviewMetric[]
    sourceRule: KpiSourceRule
  }
  healthDimensions: HealthDimension[]
  workflowQueues: WorkflowQueue[]
  projectHealth: ProjectHealth[]
  emptyState: {
    title: string
    message: string
    action: { label: string }
  } | null
}

const summaryCards = [
  {
    key: 'health',
    label: 'Portfolio Health',
    icon: ShieldCheck,
    tone: 'emerald',
  },
  {
    key: 'active',
    label: 'Active Projects',
    icon: FolderKanban,
    tone: 'sky',
  },
  {
    key: 'critical',
    label: 'Critical Activities',
    icon: Activity,
    tone: 'violet',
  },
  {
    key: 'approvals',
    label: 'Approval Queue',
    icon: ClipboardCheck,
    tone: 'amber',
  },
  {
    key: 'procurement',
    label: 'Procurement Risks',
    icon: PackageSearch,
    tone: 'rose',
  },
  {
    key: 'overdue',
    label: 'Overdue QA/Safety/Docs',
    icon: FileWarning,
    tone: 'red',
  },
] as const

function useWorkspaceDashboard() {
  return useQuery<WorkspaceDashboard>({
    queryKey: ['workspace-dashboard'],
    queryFn: () =>
      apiClient
        .get('/projects/workspace-dashboard')
        .then((response) => response.data.data),
    refetchInterval: 120000,
  })
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return '-'
  return new Intl.NumberFormat().format(Number(value))
}

function formatCompactMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return '-'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    notation: 'compact',
  }).format(Number(value))
}

function formatDate(value: string | null) {
  if (!value) return 'No date'
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function formatCutoff(value: string | null | undefined) {
  if (!value) return 'No cutoff'
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function targetSearch(target: DashboardTarget) {
  return {
    module: target.module,
    child: target.child,
    status: target.status,
    source: target.source,
    recordId: target.recordId,
  }
}

function formatKpiValue(kpi: DashboardKpi) {
  if (kpi.value === null || kpi.value === undefined) return '-'
  if (kpi.unit === 'score') return String(kpi.value)
  return formatNumber(kpi.value)
}

function kpiIcon(key: string) {
  const icons: Record<string, ComponentType<{ className?: string }>> = {
    health: ShieldCheck,
    active: FolderKanban,
    critical: Activity,
    procurement: PackageSearch,
    overdue: FileWarning,
    approvals: ClipboardCheck,
    portfolioHealth: ShieldCheck,
    activeProjects: FolderKanban,
    criticalActivities: Activity,
    costActuals: WalletCards,
    procurementAtRisk: PackageSearch,
    overdueDocQuality: FileWarning,
  }

  return icons[key] || ClipboardCheck
}

function kpiTone(key: string) {
  const tones: Record<string, string> = {
    health: 'emerald',
    active: 'sky',
    critical: 'violet',
    procurement: 'rose',
    overdue: 'red',
    approvals: 'amber',
    portfolioHealth: 'emerald',
    activeProjects: 'sky',
    criticalActivities: 'violet',
    costActuals: 'amber',
    procurementAtRisk: 'rose',
    overdueDocQuality: 'red',
  }

  return tones[key] || 'sky'
}

function formatStatus(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function scoreLabel(score: number | null | undefined) {
  if (score === null || score === undefined) return 'No data'
  if (score >= 80) return 'Good'
  if (score >= 60) return 'Watch'
  return 'At risk'
}

function scoreTone(score: number | null | undefined) {
  if (score === null || score === undefined) {
    return {
      text: 'text-muted-foreground',
      bg: 'bg-muted',
      border: 'border-border',
      bar: 'bg-muted-foreground',
    }
  }

  if (score >= 80) {
    return {
      text: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
      bar: 'bg-emerald-500',
    }
  }

  if (score >= 60) {
    return {
      text: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
      bar: 'bg-amber-500',
    }
  }

  return {
    text: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    bar: 'bg-red-500',
  }
}

function severityTone(severity: string) {
  const normalized = severity.toLowerCase()

  if (['critical', 'high', 'red'].includes(normalized)) {
    return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
  }

  if (['medium', 'attention', 'amber'].includes(normalized)) {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }

  return 'border-border bg-muted text-muted-foreground'
}

function toneClasses(tone: string) {
  const classes: Record<string, string> = {
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    red: 'bg-red-500/10 text-red-600 dark:text-red-400',
  }

  return classes[tone] || classes.sky
}

function ModuleLink({
  target,
  children,
  className,
  variant = 'ghost',
  size = 'sm',
}: {
  target: DashboardTarget
  children: ReactNode
  className?: string
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
}) {
  if (!target.projectId) {
    return (
      <Button asChild variant={variant} size={size} className={className}>
        <Link to='/projects'>{children}</Link>
      </Button>
    )
  }

  return (
    <Button asChild variant={variant} size={size} className={className}>
      <Link
        to='/projects/$projectId'
        params={{ projectId: target.projectId }}
        search={targetSearch(target)}
      >
        {children}
      </Link>
    </Button>
  )
}

function MetricCard({
  label,
  value,
  detail,
  tone,
  icon: Icon,
  target,
  source,
  cutoffDate,
  sourceStatus = 'official',
}: {
  label: string
  value: string
  detail: string
  tone: string
  icon: ComponentType<{ className?: string }>
  target?: DashboardTarget
  source?: string
  cutoffDate?: string | null
  sourceStatus?: string
}) {
  const card = (
    <Card className='h-full min-h-44 transition-colors hover:bg-muted/30'>
      <CardHeader className='flex flex-row items-start justify-between space-y-0 pb-2'>
        <div className='min-w-0 space-y-1'>
          <CardTitle className='text-sm font-medium'>{label}</CardTitle>
          <Badge
            variant='outline'
            className={cn(
              'text-[10px]',
              sourceStatus === 'pending-review'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            )}
          >
            {sourceStatus === 'pending-review' ? 'Pending' : 'Official'}
          </Badge>
        </div>
        <span className={cn('rounded-md p-2', toneClasses(tone))}>
          <Icon className='h-4 w-4' />
        </span>
      </CardHeader>
      <CardContent>
        <div className='text-2xl font-bold tabular-nums'>{value}</div>
        <p className='mt-1 text-xs text-muted-foreground'>{detail}</p>
        <div className='mt-3 space-y-1 border-t pt-2 text-[11px] text-muted-foreground'>
          <p className='line-clamp-1'>
            <span className='font-medium text-foreground'>Source:</span>{' '}
            {source || 'Dashboard source'}
          </p>
          <p>
            <span className='font-medium text-foreground'>Cutoff:</span>{' '}
            {formatCutoff(cutoffDate)}
          </p>
        </div>
      </CardContent>
    </Card>
  )

  if (!target) return card

  if (!target.projectId) {
    return (
      <Link
        to='/projects'
        className='block h-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
      >
        {card}
      </Link>
    )
  }

  return (
    <Link
      to='/projects/$projectId'
      params={{ projectId: target.projectId }}
      search={targetSearch(target)}
      className='block h-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
    >
      {card}
    </Link>
  )
}

function HealthDimensionRow({ dimension }: { dimension: HealthDimension }) {
  const tone = scoreTone(dimension.score)
  const width = `${Math.max(0, Math.min(100, Number(dimension.score || 0)))}%`

  return (
    <div className='space-y-2 rounded-md border p-3'>
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <p className='truncate text-sm font-medium'>{dimension.label}</p>
          <p className='truncate text-xs text-muted-foreground'>
            {dimension.detail}
          </p>
        </div>
        <Badge
          variant='outline'
          className={cn('shrink-0', tone.bg, tone.border, tone.text)}
        >
          {scoreLabel(dimension.score)}
        </Badge>
      </div>
      <div className='h-2 overflow-hidden rounded-full bg-muted'>
        <div
          className={cn('h-full rounded-full', tone.bar)}
          style={{ width }}
        />
      </div>
      <p
        className={cn(
          'text-right text-sm font-semibold tabular-nums',
          tone.text
        )}
      >
        {dimension.score ?? '-'}
      </p>
      <p className='text-[11px] text-muted-foreground'>
        {dimension.sourceRule?.source || 'Official source'} through{' '}
        {formatCutoff(dimension.cutoffDate)}
      </p>
    </div>
  )
}

function WorkflowQueueCard({ queue }: { queue: WorkflowQueue }) {
  return (
    <Card className='flex min-h-80 flex-col'>
      <CardHeader className='space-y-1'>
        <div className='flex items-start justify-between gap-3'>
          <div>
            <CardTitle className='text-base'>{queue.label}</CardTitle>
            <CardDescription>{queue.description}</CardDescription>
          </div>
          <Badge variant={queue.count > 0 ? 'default' : 'outline'}>
            {formatNumber(queue.count)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className='flex flex-1 flex-col gap-3'>
        {queue.items.length === 0 ? (
          <div className='flex flex-1 items-center justify-center rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground'>
            No open actions
          </div>
        ) : (
          <div className='space-y-2'>
            {queue.items.map((item) => (
              <Link
                key={item.id}
                to='/projects/$projectId'
                params={{ projectId: item.projectId }}
                search={targetSearch(item.target)}
                className='block rounded-md border p-3 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
              >
                <div className='flex items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    <p className='truncate text-sm font-medium'>{item.title}</p>
                    <p className='truncate text-xs text-muted-foreground'>
                      {item.projectName}
                    </p>
                  </div>
                  <Badge
                    variant='outline'
                    className={cn('shrink-0', severityTone(item.severity))}
                  >
                    {formatDate(item.dueDate)}
                  </Badge>
                </div>
                <p className='mt-2 line-clamp-2 text-xs text-muted-foreground'>
                  {item.meta}
                </p>
              </Link>
            ))}
          </div>
        )}

        <ModuleLink
          target={queue.defaultTarget}
          className='mt-auto w-full'
          variant='outline'
        >
          Open Queue
          <ArrowUpRight />
        </ModuleLink>
      </CardContent>
    </Card>
  )
}

function ProjectHealthRow({ project }: { project: ProjectHealth }) {
  const tone = scoreTone(project.overallScore)
  const width = `${Math.max(0, Math.min(100, project.overallScore))}%`

  return (
    <Link
      to='/projects/$projectId'
      params={{ projectId: project.id }}
      search={targetSearch(project.target)}
      className='block rounded-md border p-4 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
    >
      <div className='flex flex-col gap-4 lg:flex-row lg:items-center'>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <p className='truncate text-sm font-semibold'>{project.name}</p>
            <Badge variant='outline'>{formatStatus(project.status)}</Badge>
          </div>
          <p className='mt-1 text-xs text-muted-foreground'>
            Weakest: {project.weakestDimension.label} (
            {project.weakestDimension.score})
          </p>
        </div>
        <div className='grid min-w-0 flex-1 grid-cols-3 gap-2 text-xs text-muted-foreground'>
          <span>{project.workflowActions} actions</span>
          <span>{project.procurementRisks} procurement</span>
          <span>{project.overdueNcrRfi} doc/quality</span>
        </div>
        <div className='w-full lg:w-48'>
          <div className='mb-1 flex items-center justify-between text-xs'>
            <span className='text-muted-foreground'>Health</span>
            <span className={cn('font-semibold tabular-nums', tone.text)}>
              {project.overallScore}
            </span>
          </div>
          <div className='h-2 overflow-hidden rounded-full bg-muted'>
            <div
              className={cn('h-full rounded-full', tone.bar)}
              style={{ width }}
            />
          </div>
        </div>
      </div>
    </Link>
  )
}

function EmptyWorkspace({ data }: { data: WorkspaceDashboard }) {
  return (
    <Card className='border-dashed'>
      <CardContent className='flex flex-col items-center justify-center px-6 py-16 text-center'>
        <FolderKanban className='mb-4 h-12 w-12 text-muted-foreground' />
        <h2 className='text-xl font-semibold'>
          {data.emptyState?.title || 'No projects yet'}
        </h2>
        <p className='mt-2 max-w-xl text-sm text-muted-foreground'>
          {data.emptyState?.message}
        </p>
        <Button asChild className='mt-6'>
          <Link to='/projects'>
            <Plus />
            {data.emptyState?.action.label || 'Create Project'}
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

export function Dashboard() {
  const { data, isLoading, isError } = useWorkspaceDashboard()

  if (isLoading) {
    return (
      <Main>
        <div className='space-y-4'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>
              Workspace Control
            </h1>
            <p className='text-sm text-muted-foreground'>
              Loading construction project health...
            </p>
          </div>
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-6'>
            {summaryCards.map((card) => (
              <div
                key={card.key}
                className='h-32 animate-pulse rounded-md border bg-muted/40'
              />
            ))}
          </div>
        </div>
      </Main>
    )
  }

  if (isError || !data) {
    return (
      <Main>
        <Card>
          <CardContent className='flex flex-col items-center justify-center px-6 py-16 text-center'>
            <AlertTriangle className='mb-4 h-10 w-10 text-amber-500' />
            <h1 className='text-xl font-semibold'>Dashboard unavailable</h1>
            <p className='mt-2 text-sm text-muted-foreground'>
              The workspace summary could not be loaded.
            </p>
          </CardContent>
        </Card>
      </Main>
    )
  }

  const { summary } = data
  const cardValues: Record<(typeof summaryCards)[number]['key'], string> = {
    health:
      summary.portfolioHealthScore === null
        ? '-'
        : `${summary.portfolioHealthScore}`,
    active: `${summary.activeProjects}/${summary.totalProjects}`,
    critical: formatNumber(summary.criticalActivities),
    approvals: formatNumber(summary.approvalQueueCount),
    procurement: formatNumber(summary.procurementAtRisk),
    overdue: formatNumber(summary.overdueNcrRfi),
  }
  const cardDetails: Record<(typeof summaryCards)[number]['key'], string> = {
    health: scoreLabel(summary.portfolioHealthScore),
    active: `${formatCompactMoney(summary.totalContractValue)} contract value`,
    critical: `${formatNumber(summary.delayedActivities)} delayed activities`,
    approvals: 'Schedule, progress, IPC, and payment status',
    procurement: 'Long-lead and PO date risk',
    overdue: 'Quality and document-control follow-up',
  }
  const officialKpis: DashboardKpi[] =
    data.officialKpis && data.officialKpis.length > 0
      ? data.officialKpis
      : summaryCards.map((card) => ({
          key: card.key,
          label: card.label,
          value:
            card.key === 'health'
              ? summary.portfolioHealthScore
              : Number(cardValues[card.key].replace(/[^0-9.-]/g, '')) || 0,
          detail: cardDetails[card.key],
          sourceRule: {
            source: 'Workspace dashboard',
            formula: cardDetails[card.key],
            officialOnly: card.key !== 'approvals',
          },
          sourceStatus:
            card.key === 'approvals' ? 'pending-review' : 'official',
          cutoffDate: data.dataFreshness?.cutoffDate || data.generatedAt,
          generatedAt: data.generatedAt,
          target: { projectId: null, module: 'projects' },
        }))
  const pendingMetrics = data.pendingReview?.metrics || []

  return (
    <Main>
      <div data-testid='workspace-dashboard' className='space-y-6'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>
              Workspace Control
            </h1>
            <p className='text-sm text-muted-foreground'>
              Construction health, approval queues, and project risk signals.
            </p>
            <p className='mt-1 text-xs text-muted-foreground'>
              Official cutoff {formatCutoff(data.dataFreshness?.cutoffDate)} |
              refreshed{' '}
              {new Date(
                data.dataFreshness?.generatedAt || data.generatedAt
              ).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
          <Button asChild>
            <Link to='/projects'>
              <FolderKanban />
              Projects
            </Link>
          </Button>
        </div>

        {data.emptyState ? (
          <EmptyWorkspace data={data} />
        ) : (
          <>
            <section className='space-y-3'>
              <div>
                <h2 className='text-lg font-semibold'>Official KPIs</h2>
                <p className='text-sm text-muted-foreground'>
                  Approved source values with drill-through to source records
                </p>
              </div>
              <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-6'>
                {officialKpis.map((kpi) => (
                  <MetricCard
                    key={kpi.key}
                    label={kpi.label}
                    value={formatKpiValue(kpi)}
                    detail={kpi.detail}
                    tone={kpiTone(kpi.key)}
                    icon={kpiIcon(kpi.key)}
                    target={kpi.target}
                    source={kpi.sourceRule?.source}
                    cutoffDate={kpi.cutoffDate}
                    sourceStatus={kpi.sourceStatus}
                  />
                ))}
              </div>
            </section>

            {pendingMetrics.length > 0 && (
              <section className='space-y-3'>
                <div className='flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between'>
                  <div>
                    <h2 className='text-lg font-semibold'>Pending Review</h2>
                    <p className='text-sm text-muted-foreground'>
                      Submitted values shown separately from official KPIs
                    </p>
                  </div>
                  <Badge variant='outline' className='w-fit'>
                    {formatNumber(data.pendingReview?.total || 0)} items
                  </Badge>
                </div>
                <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-5'>
                  {pendingMetrics.map((metric) => (
                    <MetricCard
                      key={metric.key}
                      label={metric.label}
                      value={formatNumber(metric.count)}
                      detail={metric.detail}
                      tone='amber'
                      icon={ClipboardCheck}
                      target={metric.target}
                      source={metric.source}
                      cutoffDate={metric.cutoffDate}
                      sourceStatus='pending-review'
                    />
                  ))}
                </div>
              </section>
            )}

            <div className='grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]'>
              <section className='space-y-3'>
                <div>
                  <h2 className='text-lg font-semibold'>Workflow Queues</h2>
                  <p className='text-sm text-muted-foreground'>
                    Approvals and overdue actions across the workspace
                  </p>
                </div>
                <div className='grid gap-4 md:grid-cols-2 2xl:grid-cols-3'>
                  {data.workflowQueues.map((queue) => (
                    <WorkflowQueueCard key={queue.key} queue={queue} />
                  ))}
                </div>
              </section>

              <Card>
                <CardHeader>
                  <CardTitle>Health Dimensions</CardTitle>
                  <CardDescription>
                    Seven-dimension construction PM score
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-3'>
                  {data.healthDimensions.map((dimension) => (
                    <HealthDimensionRow
                      key={dimension.key}
                      dimension={dimension}
                    />
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between'>
                <div>
                  <CardTitle>Project Health Watchlist</CardTitle>
                  <CardDescription>
                    Lowest health scores and highest workflow pressure
                  </CardDescription>
                </div>
                <Button asChild variant='outline' size='sm'>
                  <Link to='/projects'>
                    View All
                    <ArrowUpRight />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {data.projectHealth.length === 0 ? (
                  <div className='rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground'>
                    No project health records yet
                  </div>
                ) : (
                  <div className='space-y-3'>
                    {data.projectHealth.map((project) => (
                      <ProjectHealthRow key={project.id} project={project} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className='grid gap-4 lg:grid-cols-3'>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between space-y-0'>
                  <CardTitle className='text-base'>Schedule Risk</CardTitle>
                  <TrendingDown className='h-4 w-4 text-muted-foreground' />
                </CardHeader>
                <CardContent>
                  <div className='text-3xl font-bold tabular-nums'>
                    {formatNumber(summary.delayedActivities)}
                  </div>
                  <p className='text-sm text-muted-foreground'>
                    Delayed active activities across the portfolio
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between space-y-0'>
                  <CardTitle className='text-base'>Commercial Flow</CardTitle>
                  <WalletCards className='h-4 w-4 text-muted-foreground' />
                </CardHeader>
                <CardContent>
                  <div className='text-3xl font-bold tabular-nums'>
                    {formatNumber(summary.approvalQueueCount)}
                  </div>
                  <p className='text-sm text-muted-foreground'>
                    Items waiting for approval or certification
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between space-y-0'>
                  <CardTitle className='text-base'>Last Refresh</CardTitle>
                  <Clock3 className='h-4 w-4 text-muted-foreground' />
                </CardHeader>
                <CardContent>
                  <div className='text-3xl font-bold tabular-nums'>
                    {new Date(data.generatedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                  <p className='text-sm text-muted-foreground'>
                    Live workspace summary
                  </p>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </Main>
  )
}
