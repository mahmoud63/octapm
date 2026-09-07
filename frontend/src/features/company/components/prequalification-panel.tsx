import { useState } from 'react'
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { formatLongDate, toDateInputValue } from '@/lib/dates'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  prequalLabel,
  useDecidePrequalification,
  useReopenPrequalification,
  useScoreCriterion,
  useVendorPrequalification,
  type PrequalCriterion,
  type PrequalDecision,
  type PrequalStatus,
} from '../hooks/use-prequalification'

/**
 * Prequalification.
 *
 * Nine weighted criteria scored out of five. The weighted score is shown with
 * what it recommends, but the recommendation is not the decision — a person
 * decides, and a decision that goes against the score says so afterwards.
 *
 * What is still missing is listed by name rather than counted, because
 * "Safety history has not been scored" is a next step and "3 outstanding" is
 * a puzzle.
 */

const TONE: Record<PrequalStatus, string> = {
  not_assessed: 'bg-muted text-muted-foreground',
  draft: 'bg-muted text-muted-foreground',
  under_review: 'bg-warning/15 text-warning-foreground',
  approved: 'bg-success/15 text-success-foreground',
  conditionally_approved: 'bg-success/10 text-success-foreground',
  rejected: 'bg-destructive/15 text-destructive',
  expired: 'bg-destructive/15 text-destructive',
}

const SCALE = [0, 1, 2, 3, 4, 5]

function ScoreRow({
  criterion,
  disabled,
  onScore,
  onExpiry,
}: {
  criterion: PrequalCriterion
  disabled: boolean
  onScore: (score: number) => void
  onExpiry: (value: string | null) => void
}) {
  return (
    <li className='py-2.5' data-testid={`uat-prequal-${criterion.key}`}>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <p className='text-sm'>
            {criterion.label}
            <span className='ms-2 text-[11px] text-muted-foreground'>
              weight {criterion.weight}
            </span>
            {criterion.expired && (
              <span className='ms-2 inline-flex items-center gap-1 text-[11px] text-destructive'>
                <AlertTriangle className='size-3' />
                expired {formatLongDate(criterion.expiresAt)}
              </span>
            )}
          </p>
          {criterion.hint && (
            <p className='text-[11px] text-muted-foreground'>{criterion.hint}</p>
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
              data-testid={`uat-prequal-score-${criterion.key}-${value}`}
              className={cn(
                'size-7 rounded-md border text-xs tabular-nums',
                criterion.score === value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'hover:bg-muted',
                disabled && 'pointer-events-none opacity-50'
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {/* Only cover and licences lapse; a track record does not. */}
      {criterion.tracksExpiry && (
        <div className='mt-2 flex flex-wrap items-center gap-2'>
          <Label
            htmlFor={`prequal-expiry-${criterion.key}`}
            className='text-[11px] text-muted-foreground'
          >
            Expires
          </Label>
          <Input
            id={`prequal-expiry-${criterion.key}`}
            type='date'
            disabled={disabled}
            value={toDateInputValue(criterion.expiresAt)}
            onChange={(event) => onExpiry(event.target.value || null)}
            className='h-7 w-40 text-xs'
            data-testid={`uat-prequal-expiry-${criterion.key}`}
          />
          {criterion.reference && (
            <span className='text-[11px] text-muted-foreground'>
              {criterion.reference}
            </span>
          )}
        </div>
      )}
    </li>
  )
}

export function PrequalificationPanel({
  companyId,
  canManage,
}: {
  companyId: string
  canManage: boolean
}) {
  const query = useVendorPrequalification(companyId)
  const score = useScoreCriterion(companyId)
  const decide = useDecidePrequalification(companyId)
  const reopen = useReopenPrequalification(companyId)

  const [validUntil, setValidUntil] = useState('')
  const [conditions, setConditions] = useState('')
  const [note, setNote] = useState('')
  const [limit, setLimit] = useState('')

  if (query.isPending) {
    return (
      <div className='flex justify-center rounded-md border py-8'>
        <Loader2 className='size-5 animate-spin text-muted-foreground' />
      </div>
    )
  }
  if (!query.data) return null

  const data = query.data
  const decided = ['approved', 'conditionally_approved', 'rejected'].includes(
    data.status
  )
  const locked = decided || !canManage

  const setScore = async (key: string, value: number) => {
    try {
      await score.mutateAsync({ key, payload: { score: value } })
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const setExpiry = async (key: string, value: string | null) => {
    try {
      await score.mutateAsync({
        key,
        payload: { expiresAt: value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null },
      })
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const record = async (status: PrequalDecision) => {
    try {
      const result = await decide.mutateAsync({
        status,
        validUntil: validUntil
          ? new Date(`${validUntil}T00:00:00.000Z`).toISOString()
          : (data.validUntil ?? null),
        conditions: conditions.trim() || data.conditions,
        decisionNote: note.trim() || data.decisionNote,
        singleAwardLimit: limit ? Number(limit) : data.singleAwardLimit,
      })
      toast.success(
        result.decisionAgainstScore
          ? `Recorded as ${prequalLabel[result.effectiveStatus].toLowerCase()}, against a score of ${result.score}.`
          : `Recorded as ${prequalLabel[result.effectiveStatus].toLowerCase()}.`
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <div className='rounded-md border p-3' data-testid='uat-prequal'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p className='text-sm font-medium'>Prequalification</p>
          <p className='text-xs text-muted-foreground'>
            {data.qualified
              ? 'This subcontractor can be invited to price work.'
              : 'A subcontractor is invited to price work once this is settled.'}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          {data.score !== null && (
            <span
              className='text-sm font-semibold tabular-nums'
              data-testid='uat-prequal-score'
            >
              {data.score}
              <span className='text-xs font-normal text-muted-foreground'>/100</span>
            </span>
          )}
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium',
              TONE[data.effectiveStatus]
            )}
            data-testid='uat-prequal-state'
          >
            {prequalLabel[data.effectiveStatus]}
          </span>
        </div>
      </div>

      {/* What the score suggests — never what it decides. */}
      {data.band && !decided && (
        <p className='mt-2 text-xs text-muted-foreground'>
          The score suggests: <span className='font-medium'>{data.band}</span>.
          The decision is yours.
        </p>
      )}
      {data.decisionAgainstScore && (
        <p className='mt-2 text-xs text-warning-foreground'>
          Recorded against the score, which suggested{' '}
          {prequalLabel[data.storedRecommendation ?? 'draft'].toLowerCase()}.
        </p>
      )}

      <ul className='mt-2 divide-y'>
        {data.criteria.map((criterion) => (
          <ScoreRow
            key={criterion.key}
            criterion={criterion}
            disabled={locked || score.isPending}
            onScore={(value) => setScore(criterion.key, value)}
            onExpiry={(value) => setExpiry(criterion.key, value)}
          />
        ))}
      </ul>

      {/* Named, not counted. */}
      {data.gaps.length > 0 && (
        <ul
          className='mt-3 space-y-1 rounded-md bg-warning/10 p-2'
          data-testid='uat-prequal-gaps'
        >
          {data.gaps.map((gap) => (
            <li key={gap} className='text-xs text-warning-foreground'>
              {gap}
            </li>
          ))}
        </ul>
      )}

      {data.expiresAt && (
        <p className='mt-3 text-xs text-muted-foreground'>
          {data.expired ? 'Expired' : 'Expires'} {formatLongDate(data.expiresAt)}
          {data.expiresBecause
            ? ` — brought forward by ${data.expiresBecause.toLowerCase()}.`
            : '.'}
        </p>
      )}
      {data.conditions && (
        <p className='mt-1 text-xs text-muted-foreground'>
          Conditions: {data.conditions}
        </p>
      )}
      {data.singleAwardLimit !== null && (
        <p className='mt-1 text-xs text-muted-foreground'>
          Approved for a single award up to{' '}
          {data.singleAwardLimit.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}
          .
        </p>
      )}

      {canManage && !decided && (
        <div className='mt-3 space-y-2 border-t pt-3'>
          <div className='grid gap-2 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label htmlFor='prequal-valid-until' className='text-xs'>
                Qualified until
              </Label>
              <Input
                id='prequal-valid-until'
                type='date'
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
                className='h-8'
                data-testid='uat-prequal-valid-until'
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='prequal-limit' className='text-xs'>
                Single-award limit (optional)
              </Label>
              <Input
                id='prequal-limit'
                type='number'
                min={0}
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                className='h-8'
                data-testid='uat-prequal-limit'
              />
            </div>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='prequal-conditions' className='text-xs'>
              Conditions or reason
            </Label>
            <Textarea
              id='prequal-conditions'
              rows={2}
              value={conditions}
              onChange={(event) => {
                setConditions(event.target.value)
                setNote(event.target.value)
              }}
              placeholder='What has to be true, or why the vendor was rejected'
              data-testid='uat-prequal-conditions'
            />
          </div>
          <div className='flex flex-wrap gap-2'>
            <Button
              size='sm'
              disabled={decide.isPending}
              onClick={() => record('approved')}
              data-testid='uat-prequal-approve'
            >
              Approve
            </Button>
            <Button
              size='sm'
              variant='outline'
              disabled={decide.isPending}
              onClick={() => record('conditionally_approved')}
              data-testid='uat-prequal-conditional'
            >
              Approve with conditions
            </Button>
            <Button
              size='sm'
              variant='ghost'
              disabled={decide.isPending}
              onClick={() => record('rejected')}
              data-testid='uat-prequal-reject'
            >
              Reject
            </Button>
          </div>
        </div>
      )}

      {canManage && decided && (
        <div className='mt-3 border-t pt-3'>
          <Button
            size='sm'
            variant='outline'
            disabled={reopen.isPending}
            onClick={async () => {
              try {
                await reopen.mutateAsync('Renewal or new evidence')
                toast.success('Reopened. The scores are kept.')
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
            data-testid='uat-prequal-reopen'
          >
            <RotateCcw className='size-4' /> Reopen
          </Button>
          <p className='mt-1 text-[11px] text-muted-foreground'>
            The scores stay; only the decision is dropped.
          </p>
        </div>
      )}
    </div>
  )
}
