import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { FINANCIAL_TERMS } from '@/lib/financial-terms'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AiRunFeedback } from '@/features/assistant/components/ai-run-feedback'
import { workspaceLink } from '@/features/workflows/hooks/use-workflow-engine'
import {
  useExplainForecast,
  useForecast,
  useRunForecastAction,
  type ForecastAction,
  type ForecastActivity,
  type ForecastExplanation,
  type ForecastLevel,
} from '../hooks/use-forecast'

const money = (value: number | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })
const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : '—'
const levelVariant = (level: ForecastLevel) =>
  level === 'high'
    ? 'destructive'
    : level === 'medium'
      ? 'secondary'
      : 'outline'
const LEVEL_LABEL: Record<ForecastLevel, string> = {
  high: 'High risk',
  medium: 'Watch',
  low: 'On track',
}
const BASIS_LABEL: Record<ForecastActivity['basis'], string> = {
  complete: 'complete',
  planned: 'as planned',
  velocity: 'at current velocity',
  pace: 'at pace so far',
  overdue: 'already past finish',
  late_start: 'late start',
}

function Kpi({
  label,
  value,
  sub,
  level,
  testId,
}: {
  label: string
  value: string
  sub?: string | null
  level?: ForecastLevel
  testId?: string
}) {
  return (
    <div className='rounded-lg border bg-card p-3' data-testid={testId}>
      <p className='text-[10px] tracking-wide text-muted-foreground uppercase'>
        {label}
      </p>
      <p
        className={cn(
          'mt-0.5 text-xl font-semibold tabular-nums',
          level === 'high' && 'text-destructive',
          level === 'medium' && 'text-amber-600 dark:text-amber-400'
        )}
      >
        {value}
      </p>
      {sub ? <p className='text-xs text-muted-foreground'>{sub}</p> : null}
    </div>
  )
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className='h-1.5 w-20 overflow-hidden rounded bg-muted'>
      <div
        className={cn(
          'h-full',
          score >= 60
            ? 'bg-destructive'
            : score >= 30
              ? 'bg-amber-500'
              : 'bg-emerald-500'
        )}
        style={{ width: `${Math.max(4, Math.min(100, score))}%` }}
      />
    </div>
  )
}

function ActivityRow({
  projectId,
  activity,
}: {
  projectId: string
  activity: ForecastActivity
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr
        className='cursor-pointer border-t hover:bg-muted/40'
        onClick={() => setOpen((value) => !value)}
        data-testid='uat-forecast-activity'
      >
        <td className='px-2 py-1.5'>
          <span className='flex items-center gap-1'>
            {open ? (
              <ChevronDown className='h-3 w-3' />
            ) : (
              <ChevronRight className='h-3 w-3' />
            )}
            <span className='font-medium'>{activity.name}</span>
            {activity.code && (
              <span className='text-xs text-muted-foreground'>
                {activity.code}
              </span>
            )}
            {activity.isCritical && (
              <Badge variant='outline' className='text-[10px]'>
                critical
              </Badge>
            )}
          </span>
        </td>
        <td className='px-2 py-1.5 tabular-nums'>
          {activity.pct}%
          {activity.expectedPct !== null && (
            <span className='text-xs text-muted-foreground'>
              {' '}
              / {activity.expectedPct}%
            </span>
          )}
        </td>
        <td className='px-2 py-1.5 tabular-nums'>
          {activity.velocity === null ? '—' : `${activity.velocity}%/d`}
        </td>
        <td className='px-2 py-1.5 tabular-nums'>
          {formatDate(activity.plannedFinish)}
        </td>
        <td className='px-2 py-1.5 tabular-nums'>
          {formatDate(activity.projectedFinish)}
        </td>
        <td
          className={cn(
            'px-2 py-1.5 tabular-nums',
            activity.slipDays > 0 && 'text-destructive'
          )}
        >
          {activity.slipDays > 0 ? `+${activity.slipDays}d` : '—'}
          {activity.impactDays > 0 ? ` (+${activity.impactDays})` : ''}
        </td>
        <td className='px-2 py-1.5 tabular-nums'>
          {activity.float === null ? '—' : `${activity.float}d`}
        </td>
        <td className='px-2 py-1.5'>
          <span className='flex items-center gap-2'>
            <ScoreBar score={activity.score} />
            <Badge
              variant={levelVariant(activity.level)}
              className='text-[10px]'
            >
              {activity.score}
            </Badge>
          </span>
        </td>
      </tr>
      {open && (
        <tr className='border-t bg-muted/20'>
          <td colSpan={8} className='px-3 py-2 text-xs'>
            <ul className='list-disc space-y-0.5 pl-4'>
              {activity.reasons.map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
              {activity.reasons.length === 0 && (
                <li>No schedule risk found.</li>
              )}
            </ul>
            {activity.blockers.length > 0 && (
              <p className='mt-1 flex flex-wrap gap-1'>
                {activity.blockers.map((blocker) => {
                  const link =
                    blocker.type === 'rfi'
                      ? workspaceLink(
                          `/projects/${projectId}/doc-control/rfi?recordId=${blocker.id}`
                        )
                      : blocker.type === 'submittal'
                        ? workspaceLink(
                            `/projects/${projectId}/doc-control/submittals?recordId=${blocker.id}`
                          )
                        : workspaceLink(
                            `/projects/${projectId}/schedule/longLead`
                          )
                  const label = `${blocker.ref || blocker.title}${blocker.overdue ? ' · overdue' : ''}`
                  return link ? (
                    <Link
                      key={blocker.id}
                      to='/projects/$projectId'
                      params={{ projectId: link.projectId }}
                      search={link.search}
                      className='rounded border px-1.5 py-0.5 underline-offset-2 hover:underline'
                    >
                      {label}
                    </Link>
                  ) : (
                    <span
                      key={blocker.id}
                      className='rounded border px-1.5 py-0.5'
                    >
                      {label}
                    </span>
                  )
                })}
              </p>
            )}
            {activity.cost.overrun > 0 && (
              <p className='mt-1 text-muted-foreground'>
                Cost: {money(activity.cost.actual)} spent of{' '}
                {money(activity.cost.budget)}, projected{' '}
                {money(activity.cost.projected)} ({money(activity.cost.overrun)}{' '}
                over) —{' '}
                {activity.cost.reasons.join('; ') || activity.cost.basis}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function ActionButtons({
  projectId,
  actions,
}: {
  projectId: string
  actions: ForecastAction[]
}) {
  const run = useRunForecastAction(projectId)
  const navigate = useNavigate()
  const canRisk = useCanPerform('risk', 'create')
  const canTask = useCanPerform('task', 'create')
  if (actions.length === 0) return null
  return (
    <div className='flex flex-wrap gap-1.5' data-testid='uat-forecast-actions'>
      {actions.map((action, index) => {
        if (action.type === 'open') {
          if (!action.activityId) return null
          return (
            <Button
              key={index}
              asChild
              size='sm'
              variant='outline'
              className='h-7'
            >
              <Link
                to='/projects/$projectId/$module/$child'
                params={{ projectId, module: 'schedule', child: 'activities' }}
                search={{ recordId: action.activityId }}
              >
                {action.label}
              </Link>
            </Button>
          )
        }
        const allowed = action.type === 'create_risk' ? canRisk : canTask
        if (!allowed) return null
        return (
          <Button
            key={index}
            size='sm'
            variant='outline'
            className='h-7'
            disabled={run.isPending}
            data-testid={`uat-forecast-action-${action.type}`}
            title={action.description ?? undefined}
            onClick={async () => {
              try {
                const result = await run.mutateAsync(action)
                toast.success(`${result.record.ref ?? 'Record'} created`)
                const target = workspaceLink(result.url)
                if (target)
                  navigate({
                    to: '/projects/$projectId',
                    params: { projectId: target.projectId },
                    search: target.search,
                  })
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {run.isPending && <Loader2 className='mr-1 h-3 w-3 animate-spin' />}
            {action.label}
          </Button>
        )
      })}
    </div>
  )
}

function Narrative({
  projectId,
  explanation,
  onClose,
}: {
  projectId: string
  explanation: ForecastExplanation
  onClose: () => void
}) {
  const { narrative } = explanation
  return (
    <div
      className='space-y-2 rounded-lg border p-3'
      data-testid='uat-forecast-narrative'
    >
      <div className='flex items-start gap-2'>
        <Sparkles className='mt-0.5 h-4 w-4 shrink-0 text-primary' />
        <p className='text-sm font-semibold'>{narrative.headline}</p>
      </div>
      {explanation.degraded && (
        <p className='text-xs text-muted-foreground'>{explanation.reason}</p>
      )}
      <div className='grid gap-2 text-sm md:grid-cols-2'>
        <div>
          <p className='text-xs font-medium text-muted-foreground uppercase'>
            Schedule
          </p>
          <p className='whitespace-pre-wrap'>{narrative.schedule}</p>
        </div>
        <div>
          <p className='text-xs font-medium text-muted-foreground uppercase'>
            Cost
          </p>
          <p className='whitespace-pre-wrap'>{narrative.cost}</p>
        </div>
      </div>
      {narrative.watch.length > 0 && (
        <p className='text-xs'>
          <span className='font-medium text-muted-foreground'>Watch: </span>
          {narrative.watch.join(' · ')}
        </p>
      )}
      <ActionButtons projectId={projectId} actions={narrative.actions} />
      <div className='flex items-center gap-2'>
        <AiRunFeedback
          projectId={projectId}
          messageId={explanation.message?.id ?? null}
          initial={explanation.message?.feedback ?? null}
          model={explanation.message?.model}
          className='mr-auto'
        />
        <Button size='sm' variant='ghost' onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}

/**
 * Schedule › Forecast: where the project is heading on the records alone —
 * projected finish and cost, the activities driving them with the reasons,
 * budget lines over — and, on request, a plain-language explanation with
 * draft actions.
 */
export function ForecastPanel({ projectId }: { projectId: string }) {
  const {
    data: forecast,
    isLoading,
    isFetching,
    refetch,
  } = useForecast(projectId)
  const explain = useExplainForecast(projectId)
  const [explanation, setExplanation] = useState<ForecastExplanation | null>(
    null
  )

  const runExplain = async () => {
    try {
      setExplanation(await explain.mutateAsync())
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  if (isLoading) {
    return (
      <div className='flex items-center gap-2 py-8 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' /> Computing the forecast…
      </div>
    )
  }
  if (
    !forecast ||
    !forecast.available ||
    !forecast.schedule ||
    !forecast.cost
  ) {
    return (
      <Alert data-testid='uat-forecast-empty'>
        <AlertTriangle className='h-4 w-4' />
        <AlertTitle>No forecast yet</AlertTitle>
        <AlertDescription>
          {forecast?.reason ??
            'Generate or import a schedule and record progress to see a forecast.'}
        </AlertDescription>
      </Alert>
    )
  }

  const { schedule, cost, summary } = forecast
  return (
    <div className='space-y-4' data-testid='uat-forecast'>
      <div className='flex flex-wrap items-center gap-2'>
        <div>
          <h3 className='text-base font-semibold'>Forecast</h3>
          <p className='text-xs text-muted-foreground'>
            From approved progress, float, recorded impacts, open items and the
            burn rate — as of {formatDate(forecast.asOf)}. Nothing here is a
            model guess; the explanation below is.
          </p>
        </div>
        <div className='ml-auto flex gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={isFetching}
            onClick={() => refetch()}
            data-testid='uat-forecast-refresh'
          >
            <RefreshCw
              className={cn('mr-1.5 h-4 w-4', isFetching && 'animate-spin')}
            />
            Recompute
          </Button>
          <Button
            size='sm'
            disabled={explain.isPending}
            onClick={runExplain}
            data-testid='uat-forecast-explain'
          >
            {explain.isPending ? (
              <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
            ) : (
              <Sparkles className='mr-1.5 h-4 w-4' />
            )}
            Explain
          </Button>
        </div>
      </div>

      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-5'>
        <Kpi
          label='Projected finish'
          value={formatDate(schedule.projectedFinish)}
          sub={
            schedule.slipDays > 0
              ? `${schedule.slipDays} days after the plan (${formatDate(schedule.plannedFinish)})`
              : `On the planned ${formatDate(schedule.plannedFinish)}`
          }
          level={summary?.scheduleLevel}
          testId='uat-forecast-finish'
        />
        <Kpi
          label='Main driver'
          value={schedule.criticalDriver?.name ?? '—'}
          sub={
            schedule.criticalDriver
              ? `${schedule.criticalDriver.slipDays} days of slip`
              : 'No activity moves the finish'
          }
        />
        <Kpi
          label='SPI / CPI'
          value={`${schedule.spi ?? '—'} / ${schedule.cpi ?? '—'}`}
          sub={
            schedule.basis === 'earned_value'
              ? 'Finish projected from SPI'
              : 'Finish projected from activities'
          }
          level={
            (schedule.spi !== null && schedule.spi < 0.9) ||
            (schedule.cpi !== null && schedule.cpi < 0.9)
              ? 'medium'
              : undefined
          }
        />
        <Kpi
          label='Projected cost'
          value={money(cost.projected)}
          sub={
            cost.overrun > 0
              ? `${money(cost.overrun)} over the ${money(cost.budget)} budget${cost.overrunPct !== null ? ` (${cost.overrunPct}%)` : ''}`
              : `Within the ${money(cost.budget)} budget`
          }
          level={summary?.costLevel}
          testId='uat-forecast-cost'
        />
        <Kpi
          label='At risk'
          value={`${schedule.counts.atRisk.high + schedule.counts.atRisk.medium} of ${schedule.counts.open}`}
          sub={`${schedule.counts.atRisk.high} high · ${schedule.counts.atRisk.medium} watch · ${cost.counts.lines} budget line${cost.counts.lines === 1 ? '' : 's'} over`}
        />
      </div>

      {explanation && (
        <Narrative
          projectId={projectId}
          explanation={explanation}
          onClose={() => setExplanation(null)}
        />
      )}

      <section className='space-y-2'>
        <h4 className='text-sm font-semibold'>Activities driving the finish</h4>
        {schedule.topRisks.length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            No open activity shows a schedule risk from the records.
          </p>
        ) : (
          <div className='overflow-x-auto rounded-md border'>
            <table className='w-full text-sm'>
              <thead className='bg-muted/50 text-xs text-muted-foreground'>
                <tr>
                  <th className='px-2 py-1.5 text-left font-medium'>
                    Activity
                  </th>
                  <th className='px-2 py-1.5 text-left font-medium'>
                    Done / expected
                  </th>
                  <th className='px-2 py-1.5 text-left font-medium'>
                    Velocity
                  </th>
                  <th className='px-2 py-1.5 text-left font-medium'>Planned</th>
                  <th className='px-2 py-1.5 text-left font-medium'>
                    Projected
                  </th>
                  <th className='px-2 py-1.5 text-left font-medium'>Slip</th>
                  <th className='px-2 py-1.5 text-left font-medium'>Float</th>
                  <th className='px-2 py-1.5 text-left font-medium'>Risk</th>
                </tr>
              </thead>
              <tbody>
                {schedule.topRisks.map((activity) => (
                  <ActivityRow
                    key={activity.id}
                    projectId={projectId}
                    activity={activity}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className='text-[11px] text-muted-foreground'>
          Projection basis per activity:{' '}
          {Object.entries(BASIS_LABEL)
            .filter(([key]) => key !== 'complete' && key !== 'planned')
            .map(([, label]) => label)
            .join(', ')}
          . Click a row for the reasons.
        </p>
      </section>

      <div className='grid gap-4 lg:grid-cols-2'>
        <section className='space-y-2'>
          <h4 className='text-sm font-semibold'>Activities over budget</h4>
          {cost.topRisks.length === 0 ? (
            <p className='text-sm text-muted-foreground'>
              No activity is projected over its budget.
            </p>
          ) : (
            <div className='overflow-x-auto rounded-md border'>
              <table className='w-full text-sm'>
                <thead className='bg-muted/50 text-xs text-muted-foreground'>
                  <tr>
                    <th className='px-2 py-1.5 text-left font-medium'>
                      Activity
                    </th>
                    <th className='px-2 py-1.5 text-right font-medium'>
                      Budget
                    </th>
                    <th className='px-2 py-1.5 text-right font-medium'>
                      Spent
                    </th>
                    <th className='px-2 py-1.5 text-right font-medium'>
                      Projected
                    </th>
                    <th className='px-2 py-1.5 text-right font-medium'>Over</th>
                  </tr>
                </thead>
                <tbody>
                  {cost.topRisks.map((activity) => (
                    <tr
                      key={activity.id}
                      className='border-t'
                      data-testid='uat-forecast-cost-row'
                    >
                      <td className='px-2 py-1.5'>
                        <span className='font-medium'>{activity.name}</span>
                        <span className='block text-xs text-muted-foreground'>
                          {activity.cost.reasons.join('; ') ||
                            `projected from ${activity.cost.basis}`}
                        </span>
                      </td>
                      <td className='px-2 py-1.5 text-right tabular-nums'>
                        {money(activity.cost.budget)}
                      </td>
                      <td className='px-2 py-1.5 text-right tabular-nums'>
                        {money(activity.cost.actual)}
                      </td>
                      <td className='px-2 py-1.5 text-right tabular-nums'>
                        {money(activity.cost.projected)}
                      </td>
                      <td className='px-2 py-1.5 text-right text-destructive tabular-nums'>
                        {money(activity.cost.overrun)}
                        <span className='block text-[10px]'>
                          {activity.cost.overrunPct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className='space-y-2'>
          <h4 className='text-sm font-semibold'>Budget lines over</h4>
          {cost.budgetLines.length === 0 ? (
            <p className='text-sm text-muted-foreground'>
              No budget line has a forecast or commitments above its revised
              budget.
            </p>
          ) : (
            <div className='overflow-x-auto rounded-md border'>
              <table className='w-full text-sm'>
                <thead className='bg-muted/50 text-xs text-muted-foreground'>
                  <tr>
                    <th className='px-2 py-1.5 text-left font-medium'>
                      Cost code
                    </th>
                    <th className='px-2 py-1.5 text-right font-medium'>
                      Revised
                    </th>
                    <th
                      className='px-2 py-1.5 text-right font-medium'
                      title={FINANCIAL_TERMS.executedCommitments.hint}
                    >
                      {FINANCIAL_TERMS.executedCommitments.label}
                    </th>
                    <th className='px-2 py-1.5 text-right font-medium'>
                      Forecast
                    </th>
                    <th className='px-2 py-1.5 text-right font-medium'>Over</th>
                  </tr>
                </thead>
                <tbody>
                  {cost.budgetLines.map((line) => (
                    <tr
                      key={line.id}
                      className='border-t'
                      data-testid='uat-forecast-line'
                    >
                      <td className='px-2 py-1.5'>
                        <span className='font-mono text-xs'>
                          {line.costCode}
                        </span>{' '}
                        {line.name}
                        {line.costType && (
                          <span className='block text-xs text-muted-foreground'>
                            {line.costType}
                          </span>
                        )}
                      </td>
                      <td className='px-2 py-1.5 text-right tabular-nums'>
                        {money(line.revised)}
                      </td>
                      <td className='px-2 py-1.5 text-right tabular-nums'>
                        {money(line.committed)}
                      </td>
                      <td className='px-2 py-1.5 text-right tabular-nums'>
                        {money(line.forecast)}
                      </td>
                      <td className='px-2 py-1.5 text-right text-destructive tabular-nums'>
                        {money(line.overrun)}
                        {line.overrunPct !== null && (
                          <span className='block text-[10px]'>
                            {line.overrunPct}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {forecast.dataQuality.length > 0 && (
        <Alert data-testid='uat-forecast-data-quality'>
          <AlertTriangle className='h-4 w-4' />
          <AlertTitle>What would sharpen this forecast</AlertTitle>
          <AlertDescription>
            <ul className='list-disc space-y-0.5 pl-4 text-xs'>
              {forecast.dataQuality.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <p className='text-[11px] text-muted-foreground'>
        Levels:{' '}
        <Badge variant='destructive' className='text-[10px]'>
          {LEVEL_LABEL.high}
        </Badge>{' '}
        score 60+,{' '}
        <Badge variant='secondary' className='text-[10px]'>
          {LEVEL_LABEL.medium}
        </Badge>{' '}
        30–59,{' '}
        <Badge variant='outline' className='text-[10px]'>
          {LEVEL_LABEL.low}
        </Badge>{' '}
        below.
      </p>
    </div>
  )
}
