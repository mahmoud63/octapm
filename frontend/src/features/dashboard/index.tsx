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
  User,
  WalletCards,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { evCutoffNote, formatEvCutoff, type EvCutoff } from '@/lib/ev-cutoff'
import { statusBadge } from '@/lib/status'
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
import { MyWorkflowStepsSection } from '@/features/workflows/components/my-workflow-steps'
import { QuickActions } from './quick-actions'

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

type MyOpenItem = {
  recordType: string
  label: string
  recordId: string
  ref: string
  title: string | null
  status: string | null
  projectId: string
  projectName: string | null
  roles: string[]
  ballInCourt: boolean
  dueDate: string | null
  overdue: boolean
  updatedAt: string | null
  target: DashboardTarget
}

type MyOpenItems = {
  items: MyOpenItem[]
  summary: {
    total: number
    overdue: number
    ballInCourt: number
    byType: Record<string, number>
  }
}

type WorkspaceDashboard = {
  generatedAt: string
  dataFreshness?: {
    generatedAt: string
    cutoffDate: string | null
    /** When the official cutoff is a project's EV cutoff: its date and zone. */
    cutoffLocalDate?: string | null
    cutoffTimeZone?: string | null
    cutoffTimeZoneSource?: string | null
    /** The server's note when that project has no zone of its own. */
    cutoffTimeZoneNote?: string | null
    sourceUpdatedAt: string | null
    note: string
  }
  myOpenItems?: MyOpenItems
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

/**
 * KPI tones, mapped onto the OctaPM palette rather than Tailwind's.
 * The legacy tone names are kept so callers do not all have to change at once.
 */
const TONE_TOKENS: Record<string, { icon: string; stripe: string }> = {
  emerald: { icon: 'bg-success-soft text-success', stripe: 'bg-success' },
  sky: { icon: 'bg-info-soft text-info', stripe: 'bg-info' },
  violet: { icon: 'bg-accent text-interactive', stripe: 'bg-interactive' },
  amber: { icon: 'bg-warning-soft text-warning-foreground', stripe: 'bg-warning' },
  rose: { icon: 'bg-error-soft text-error', stripe: 'bg-error' },
  red: { icon: 'bg-error-soft text-error', stripe: 'bg-error' },
  brand: { icon: 'bg-accent text-primary', stripe: 'bg-primary' },
}

function toneClasses(tone: string) {
  return (TONE_TOKENS[tone] || TONE_TOKENS.sky).icon
}

function toneStripe(tone: string) {
  return (TONE_TOKENS[tone] || TONE_TOKENS.sky).stripe
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
  const pending = sourceStatus === 'pending-review'
  // Provenance still matters — it is what makes a figure auditable — but it
  // does not need to occupy half the card. It moves to a single muted line
  // with the full detail on hover.
  const provenance = `Source: ${source || 'Dashboard source'} · Cutoff: ${formatCutoff(cutoffDate)}`

  const card = (
    <Card
      title={provenance}
      className='relative h-full gap-0 overflow-hidden py-4 transition-colors hover:bg-accent/40'
    >
      {/* A tone stripe on the leading edge makes a row of KPIs scannable
          without giving each card a coloured background. */}
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-0 w-[3px]', toneStripe(tone))}
      />
      <CardHeader className='flex flex-row items-start justify-between gap-2 space-y-0 px-4 pb-2'>
        <CardTitle className='min-w-0 text-xs font-medium tracking-wide text-muted-foreground uppercase'>
          {label}
        </CardTitle>
        <span className={cn('shrink-0 rounded-md p-1.5', toneClasses(tone))}>
          <Icon className='h-3.5 w-3.5' />
        </span>
      </CardHeader>

      <CardContent className='px-4'>
        {/* The figure leads. Space Grotesk and tabular figures so a row of
            numbers lines up and reads as one set. */}
        <div className='font-display text-[1.75rem] leading-none font-bold tabular-nums text-foreground'>
          {value}
        </div>
        <p className='mt-1.5 line-clamp-2 text-xs text-muted-foreground'>{detail}</p>

        <div className='mt-3 flex items-center gap-1.5'>
          <Badge
            variant='outline'
            className={cn('px-1.5 py-0 text-[10px]', statusBadge(pending ? 'review' : 'done'))}
          >
            {pending ? 'Pending' : 'Official'}
          </Badge>
          <span className='truncate text-[10px] text-muted-foreground'>
            {formatCutoff(cutoffDate)}
          </span>
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

const roleLabels: Record<string, string> = {
  owner: 'Owner',
  reviewer: 'Reviewer',
  approver: 'Approver',
  assignee: 'Assignee',
  ballInCourt: 'Ball in court',
}

function MyOpenItemsSection({ data }: { data: MyOpenItems }) {
  const items = data.items.slice(0, 12)
  return (
    <section className='space-y-3' data-testid='uat-my-open-items'>
      <div className='flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <h2 className='text-lg font-semibold'>My open items</h2>
          <p className='text-sm text-muted-foreground'>
            Records where you are owner, reviewer, approver, assignee, or hold
            the ball — matched by user, not by name.
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Badge variant='outline'>
            {formatNumber(data.summary.total)} open
          </Badge>
          {data.summary.ballInCourt > 0 && (
            <Badge>
              {formatNumber(data.summary.ballInCourt)} in your court
            </Badge>
          )}
          {data.summary.overdue > 0 && (
            <Badge variant='destructive'>
              {formatNumber(data.summary.overdue)} overdue
            </Badge>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <Card>
          <CardContent className='py-8 text-center text-sm text-muted-foreground'>
            Nothing is waiting on you right now.
          </CardContent>
        </Card>
      ) : (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {items.map((item) => (
            <Link
              key={`${item.recordType}-${item.recordId}`}
              to='/projects/$projectId'
              params={{ projectId: item.projectId }}
              search={targetSearch(item.target)}
              data-testid={`uat-my-open-item-${item.recordType}`}
              className={cn(
                'rounded-md border bg-card p-3 transition-colors hover:bg-muted/40',
                item.ballInCourt && 'border-primary/50'
              )}
            >
              <div className='flex items-start justify-between gap-2'>
                <div className='min-w-0'>
                  <p className='text-xs text-muted-foreground'>
                    {item.label} · {item.ref}
                  </p>
                  <p className='truncate text-sm font-medium'>{item.title}</p>
                  <p className='truncate text-xs text-muted-foreground'>
                    {item.projectName}
                  </p>
                </div>
                {item.ballInCourt && (
                  <Badge className='shrink-0'>Your move</Badge>
                )}
              </div>
              <div className='mt-2 flex flex-wrap items-center gap-1.5'>
                <Badge variant='outline'>
                  {formatStatus(item.status || '')}
                </Badge>
                {item.roles
                  .filter((role) => role !== 'ballInCourt')
                  .map((role) => (
                    <Badge key={role} variant='secondary'>
                      {roleLabels[role] ?? role}
                    </Badge>
                  ))}
                {item.dueDate && (
                  <span
                    className={cn(
                      'ms-auto text-xs',
                      item.overdue
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                    )}
                  >
                    {item.overdue ? 'Overdue · ' : 'Due '}
                    {formatDate(item.dueDate)}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
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

/**
 * The personal variant of the workspace dashboard (workspace switching doc
 * §7, ENT-6): a personal workspace is one person's, so the page is titled
 * as theirs and the team sections — workflow queues, the project watchlist
 * — stay hidden until it holds more than one project. No new data: the same
 * dashboard answer, with labels and visibility for one person.
 */
function PersonalWorkspaceNote({
  segment,
  isOwner,
}: {
  segment: string
  isOwner: boolean
}) {
  return (
    <Card className='border-dashed' data-testid='dashboard-personal-note'>
      <CardContent className='flex flex-col gap-3 py-4 text-sm sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex items-start gap-3'>
          <User className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
          <p className='text-muted-foreground'>
            This is your personal workspace: one member, you, plus any guests
            you bring onto a project. To work with a team, convert it to a
            company workspace.
          </p>
        </div>
        {isOwner && (
          <Button asChild variant='outline' size='sm' className='shrink-0'>
            <Link
              to='/o/$orgSlug/company/workspace'
              params={{ orgSlug: segment }}
              data-testid='dashboard-personal-convert'
            >
              Convert to company
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export function Dashboard() {
  const { data, isLoading, isError } = useWorkspaceDashboard()
  const workspace = useAuthStore((state) => state.auth.workspace)
  const personal = workspace?.kind === 'personal'

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
  // A personal workspace shows its team sections only once it holds more
  // than one project (workspace switching doc §7).
  const showTeamSections = !personal || summary.totalProjects > 1
  // The official cutoff, when it is a project's EV cutoff, is stated as the
  // EV screens state it (lib/ev-cutoff): date, zone, instant, and the
  // server's note when that project has no zone of its own.
  const officialCutoff: EvCutoff = {
    cutoffDate: data.dataFreshness?.cutoffDate,
    cutoffLocalDate: data.dataFreshness?.cutoffLocalDate,
    timeZone: data.dataFreshness?.cutoffTimeZone,
    timeZoneSource: data.dataFreshness?.cutoffTimeZoneSource,
    timeZoneNote: data.dataFreshness?.cutoffTimeZoneNote,
  }
  const officialCutoffNote = evCutoffNote(officialCutoff)

  return (
    <Main>
      <div
        data-testid='workspace-dashboard'
        data-workspace-kind={personal ? 'personal' : 'company'}
        className='space-y-6'
      >
        <div className='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
          <div>
            <h1
              className='text-2xl font-bold tracking-tight'
              data-testid='dashboard-title'
            >
              {personal ? 'My Workspace' : 'Workspace Control'}
            </h1>
            <p className='text-sm text-muted-foreground'>
              {personal
                ? 'Your projects, open items and progress signals.'
                : 'Construction health, approval queues, and project risk signals.'}
            </p>
            <p className='mt-1 text-xs text-muted-foreground'>
              Official cutoff{' '}
              <span data-testid='workspace-official-cutoff'>
                {officialCutoff.timeZone
                  ? formatEvCutoff(officialCutoff)
                  : formatCutoff(data.dataFreshness?.cutoffDate)}
              </span>{' '}
              | refreshed{' '}
              {new Date(
                data.dataFreshness?.generatedAt || data.generatedAt
              ).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            {officialCutoffNote && (
              <p
                className='text-xs text-muted-foreground'
                data-testid='workspace-official-cutoff-zone-note'
              >
                {officialCutoffNote}
              </p>
            )}
          </div>
          <Button asChild>
            <Link to='/projects'>
              <FolderKanban />
              Projects
            </Link>
          </Button>
        </div>

        {personal && workspace && (
          <PersonalWorkspaceNote
            segment={workspace.segment}
            isOwner={workspace.isOwner}
          />
        )}

        {!data.emptyState && <QuickActions />}

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

            <MyWorkflowStepsSection />

            {data.myOpenItems && <MyOpenItemsSection data={data.myOpenItems} />}

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

            <div
              className={cn(
                'grid gap-4',
                showTeamSections && 'xl:grid-cols-[minmax(0,1fr)_360px]'
              )}
            >
              {showTeamSections && (
                <section
                  className='space-y-3'
                  data-testid='dashboard-workflow-queues'
                >
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
              )}

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

            {showTeamSections && (
              <Card data-testid='dashboard-project-watchlist'>
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
            )}

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
