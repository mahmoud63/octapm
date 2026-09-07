import { useState } from 'react'
import { Loader2, Lock, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  useEvaluation,
  useEvaluationDecision,
  useEvaluationVerdict,
  useScoreEvaluationCriterion,
  type EvaluationCriterion,
} from '../hooks/use-evaluation'

/**
 * Performance evaluation.
 *
 * Six lines carry a padlock: they are read from the non-conformances, punch
 * items, safety incidents, change orders and closeout handover, and each says
 * what it found. Scoring one of those differently is an override and needs a
 * reason — the reading stays beside it.
 *
 * A line with nothing to measure shows what was missing rather than a zero,
 * because scoring a subcontractor down for a record nobody kept measures the
 * project instead.
 */

const SCALE = [0, 1, 2, 3, 4, 5]

function CriterionRow({
  criterion,
  disabled,
  onScore,
}: {
  criterion: EvaluationCriterion
  disabled: boolean
  onScore: (score: number | null) => void
}) {
  const derived = criterion.source === 'derived'
  const unmeasurable = derived && criterion.derivedScore === null && !criterion.overridden

  return (
    <li className='py-2.5' data-testid={`uat-evaluation-${criterion.key}`}>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <p className='flex items-center gap-1.5 text-sm'>
            {criterion.label}
            {derived && (
              <Lock
                className='size-3 text-muted-foreground'
                aria-label='Read from the records'
              />
            )}
            <span className='text-[11px] text-muted-foreground'>
              weight {criterion.weight}
            </span>
            {unmeasurable && (
              <span className='text-[11px] text-muted-foreground'>
                not counted
              </span>
            )}
          </p>
          {/* What the records actually said, or what a person is judging. */}
          <p className='text-[11px] text-muted-foreground'>
            {criterion.detail ?? criterion.hint}
          </p>
          {criterion.overridden && (
            <p className='text-[11px] text-warning-foreground'>
              Scored {criterion.score} instead of {criterion.derivedScore} —{' '}
              {criterion.overrideReason}
            </p>
          )}
        </div>

        <div className='flex shrink-0 items-center gap-1'>
          {SCALE.map((value) => (
            <button
              key={value}
              type='button'
              disabled={disabled}
              onClick={() => onScore(value)}
              aria-label={`${criterion.label}: ${value} out of ${criterion.maxScore}`}
              data-testid={`uat-evaluation-score-${criterion.key}-${value}`}
              className={cn(
                'size-7 rounded-md border text-xs tabular-nums',
                criterion.score === value
                  ? criterion.overridden
                    ? 'border-warning bg-warning/20 text-warning-foreground'
                    : 'border-primary bg-primary text-primary-foreground'
                  : 'hover:bg-muted',
                disabled && 'pointer-events-none opacity-50'
              )}
            >
              {value}
            </button>
          ))}
          {criterion.overridden && !disabled && (
            <Button
              size='sm'
              variant='ghost'
              onClick={() => onScore(null)}
              data-testid={`uat-evaluation-clear-${criterion.key}`}
            >
              Undo
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

export function EvaluationPanel({
  projectId,
  commitmentId,
}: {
  projectId: string
  commitmentId: string
}) {
  const query = useEvaluation(projectId, commitmentId)
  const score = useScoreEvaluationCriterion(projectId, commitmentId)
  const verdict = useEvaluationVerdict(projectId, commitmentId)
  const decide = useEvaluationDecision(projectId, commitmentId)
  const canManage = useCanPerform('commitment', 'update', 'evaluation.manage')
  const canApprove = useCanPerform('commitment', 'approve', 'evaluation.approve')

  const [overriding, setOverriding] = useState<{ key: string; score: number } | null>(null)
  const [reason, setReason] = useState('')
  const [summary, setSummary] = useState<string | null>(null)

  if (query.isPending) {
    return (
      <div className='flex justify-center rounded-md border py-8'>
        <Loader2 className='size-5 animate-spin text-muted-foreground' />
      </div>
    )
  }
  if (!query.data) return null

  const data = query.data
  const isFinal = data.status === 'final'
  const locked = isFinal || !canManage

  const setScore = async (criterion: EvaluationCriterion, value: number | null) => {
    // Overriding what the records say needs a reason, so ask for one here
    // rather than let the server refuse after the click.
    if (criterion.source === 'derived' && value !== null) {
      setOverriding({ key: criterion.key, score: value })
      setReason('')
      return
    }
    try {
      await score.mutateAsync({ key: criterion.key, score: value })
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const saveOverride = async () => {
    if (!overriding || !reason.trim()) return
    try {
      await score.mutateAsync({
        key: overriding.key,
        score: overriding.score,
        overrideReason: reason.trim(),
      })
      setOverriding(null)
      setReason('')
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const setReuse = async (value: boolean) => {
    try {
      await verdict.mutateAsync({ wouldReuse: data.wouldReuse === value ? null : value })
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <div className='rounded-md border p-3' data-testid='uat-evaluation'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p className='text-sm font-medium'>Performance</p>
          <p className='text-xs text-muted-foreground'>
            {isFinal
              ? 'Final. This counts towards their record and shows on their next prequalification.'
              : 'Most of this is read from the records. Rate the two things nobody can count.'}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          {data.score !== null && (
            <span
              className='text-sm font-semibold tabular-nums'
              data-testid='uat-evaluation-score'
            >
              {data.score}
              <span className='text-xs font-normal text-muted-foreground'>/100</span>
            </span>
          )}
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium',
              isFinal
                ? 'bg-success/15 text-success-foreground'
                : 'bg-warning/15 text-warning-foreground'
            )}
            data-testid='uat-evaluation-state'
          >
            {isFinal ? 'Final' : `${data.gaps.length} outstanding`}
          </span>
        </div>
      </div>

      <ul className='mt-2 divide-y'>
        {data.criteria.map((criterion) => (
          <CriterionRow
            key={criterion.key}
            criterion={criterion}
            disabled={locked || score.isPending}
            onScore={(value) => setScore(criterion, value)}
          />
        ))}
      </ul>

      {overriding && (
        <div className='mt-2 flex flex-wrap gap-2'>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder='Why score this differently from the records?'
            className='min-w-56 flex-1'
            data-testid='uat-evaluation-override-reason'
          />
          <Button
            size='sm'
            disabled={!reason.trim() || score.isPending}
            onClick={saveOverride}
            data-testid='uat-evaluation-override-save'
          >
            Override
          </Button>
          <Button size='sm' variant='ghost' onClick={() => setOverriding(null)}>
            Cancel
          </Button>
        </div>
      )}

      {/* What could not be measured, and why — never a silent zero. */}
      {data.unmeasurable.length > 0 && (
        <ul className='mt-3 space-y-1 rounded-md bg-muted/50 p-2'>
          {data.unmeasurable.map((line) => (
            <li key={line} className='text-[11px] text-muted-foreground'>
              {line}
            </li>
          ))}
        </ul>
      )}

      <div className='mt-3 border-t pt-3'>
        <p className='text-xs font-medium'>Would you use them again?</p>
        <div className='mt-1.5 flex gap-2'>
          <Button
            size='sm'
            variant={data.wouldReuse === true ? 'default' : 'outline'}
            disabled={locked || verdict.isPending}
            onClick={() => setReuse(true)}
            data-testid='uat-evaluation-reuse-yes'
          >
            <ThumbsUp className='size-4' /> Yes
          </Button>
          <Button
            size='sm'
            variant={data.wouldReuse === false ? 'destructive' : 'outline'}
            disabled={locked || verdict.isPending}
            onClick={() => setReuse(false)}
            data-testid='uat-evaluation-reuse-no'
          >
            <ThumbsDown className='size-4' /> No
          </Button>
        </div>
        <Textarea
          className='mt-2'
          rows={2}
          disabled={locked}
          value={summary ?? data.summary ?? ''}
          onChange={(event) => setSummary(event.target.value)}
          onBlur={async () => {
            if (summary === null || summary === (data.summary ?? '')) return
            try {
              await verdict.mutateAsync({ summary })
              setSummary(null)
            } catch (error) {
              toast.error(getServerErrorMessage(error))
            }
          }}
          placeholder='What went well, and what did not'
          data-testid='uat-evaluation-summary'
        />
      </div>

      {data.gaps.length > 0 && !isFinal && (
        <ul
          className='mt-3 space-y-1 rounded-md bg-warning/10 p-2'
          data-testid='uat-evaluation-gaps'
        >
          {data.gaps.map((gap) => (
            <li key={gap} className='text-xs text-warning-foreground'>
              {gap}
            </li>
          ))}
        </ul>
      )}

      {canApprove && (
        <div className='mt-3 flex flex-wrap gap-2'>
          {!isFinal && (
            <Button
              size='sm'
              variant='outline'
              disabled={decide.isPending}
              onClick={async () => {
                try {
                  await decide.mutateAsync({ action: 'final' })
                  toast.success('Evaluation final. It now counts towards their record.')
                } catch (error) {
                  toast.error(getServerErrorMessage(error))
                }
              }}
              data-testid='uat-evaluation-final'
            >
              Finalise
            </Button>
          )}
          {isFinal && (
            <Button
              size='sm'
              variant='ghost'
              disabled={decide.isPending}
              onClick={async () => {
                try {
                  await decide.mutateAsync({
                    action: 'reopen',
                    reason: 'Reopened for review',
                  })
                  toast.success('Reopened. The scores are kept.')
                } catch (error) {
                  toast.error(getServerErrorMessage(error))
                }
              }}
              data-testid='uat-evaluation-reopen'
            >
              <RotateCcw className='size-4' /> Reopen
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
