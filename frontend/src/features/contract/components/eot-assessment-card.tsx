import { useState } from 'react'
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AiRunFeedback } from '@/features/assistant/components/ai-run-feedback'
import {
  useApplyEotAssessment,
  useAssessEotClaim,
  type EotAssessment,
} from '../hooks/use-contract'

const ENTITLEMENT_LABEL = {
  likely: 'Entitlement likely',
  partial: 'Partial entitlement',
  unlikely: 'Entitlement unlikely',
} as const
const entitlementVariant = (value: keyof typeof ENTITLEMENT_LABEL) =>
  value === 'likely'
    ? 'default'
    : value === 'partial'
      ? 'secondary'
      : 'destructive'
const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : '—'

function List({
  title,
  items,
  tone,
}: {
  title: string
  items: string[]
  tone?: 'warn'
}) {
  if (items.length === 0) return null
  return (
    <div className='text-xs'>
      <p className='font-medium text-muted-foreground'>{title}</p>
      <ul className='list-disc space-y-0.5 pl-4'>
        {items.map((item, index) => (
          <li
            key={index}
            className={
              tone === 'warn' ? 'text-amber-700 dark:text-amber-300' : undefined
            }
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * On an EOT claim: assess entitlement against the clauses, the notices, the
 * critical-path impact and the evidence; the narrative and the claim letter
 * are editable and applied to the claim only when the person says so.
 */
export function EotAssessmentCard({
  projectId,
  claimId,
  claimStatus,
}: {
  projectId: string
  claimId: string
  claimStatus: string
}) {
  const assess = useAssessEotClaim(projectId)
  const apply = useApplyEotAssessment(projectId)
  const canApply = useCanPerform('eot', 'update')
  const [result, setResult] = useState<EotAssessment | null>(null)
  const [narrative, setNarrative] = useState('')
  const [letter, setLetter] = useState('')

  const run = async () => {
    try {
      const assessed = await assess.mutateAsync({ claimId })
      setResult(assessed)
      setNarrative(assessed.assessment.narrative)
      setLetter(assessed.assessment.claimLetter ?? '')
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  const applyPart = async (part: 'analysis' | 'claimLetter') => {
    try {
      await apply.mutateAsync({
        claimId,
        ...(part === 'analysis'
          ? { analysis: narrative.trim() }
          : { claimLetter: letter.trim() }),
      })
      toast.success(
        part === 'analysis'
          ? 'Analysis written to the claim'
          : 'Claim letter written to the claim'
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <div className='space-y-3' data-testid='uat-eot-assessment'>
      <div className='flex flex-wrap items-center gap-2'>
        <p className='text-xs text-muted-foreground'>
          Checks the claim against the contract clauses, the notices served, the
          critical-path impact and the evidence on record. Nothing is written to
          the claim until you apply it.
        </p>
        <Button
          size='sm'
          className='ml-auto'
          disabled={assess.isPending}
          onClick={run}
          data-testid='uat-eot-assess'
        >
          {assess.isPending ? (
            <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
          ) : (
            <Sparkles className='mr-1.5 h-4 w-4' />
          )}
          Assess entitlement
        </Button>
      </div>
      {result && (
        <div
          className='space-y-3 rounded-md border p-3'
          data-testid='uat-eot-assessment-result'
        >
          <div className='flex flex-wrap items-center gap-2'>
            <Badge variant={entitlementVariant(result.assessment.entitlement)}>
              {ENTITLEMENT_LABEL[result.assessment.entitlement]}
            </Badge>
            <span className='text-sm'>
              Recommended <strong>{result.assessment.recommendedDays}</strong>{' '}
              of {result.claim.delayDays} claimed days
              {result.claim.eotDaysGranted
                ? ` (${result.claim.eotDaysGranted} requested)`
                : ''}
            </span>
            {result.degraded && (
              <span className='text-xs text-muted-foreground'>
                {result.reason}
              </span>
            )}
          </div>
          <div className='grid gap-3 md:grid-cols-2'>
            <List title='Basis' items={result.assessment.basis} />
            <List
              title='Gaps to close'
              items={result.assessment.gaps}
              tone='warn'
            />
            <List title='Concurrency' items={result.assessment.concurrency} />
            <div className='text-xs'>
              <p className='font-medium text-muted-foreground'>
                Notice compliance
              </p>
              <p>{result.assessment.noticeCompliance}</p>
              {result.notices.length > 0 && (
                <ul className='mt-1 space-y-0.5'>
                  {result.notices.map((notice) => (
                    <li
                      key={`${notice.recordType}:${notice.recordId}`}
                      className='flex items-center gap-1.5'
                    >
                      <Badge
                        variant={
                          notice.status === 'missed'
                            ? 'destructive'
                            : notice.status === 'served'
                              ? 'outline'
                              : 'secondary'
                        }
                        className='text-[10px]'
                      >
                        {notice.status}
                      </Badge>
                      <span>
                        {notice.ref ?? notice.title} · deadline{' '}
                        {formatDate(notice.deadline)}
                        {notice.served
                          ? ` · ${notice.served.ref ?? 'notice'} ${formatDate(notice.served.date)}`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <p className='text-xs text-muted-foreground'>
            Evidence in {result.evidence.window.from ?? '—'} →{' '}
            {result.evidence.window.to ?? '—'}:{' '}
            {result.evidence.logDelays.length} daily-log delay entr
            {result.evidence.logDelays.length === 1 ? 'y' : 'ies'},{' '}
            {result.evidence.attachments.length} attachment
            {result.evidence.attachments.length === 1 ? '' : 's'},{' '}
            {result.evidence.correspondence.length} linked letter
            {result.evidence.correspondence.length === 1 ? '' : 's'}.
          </p>
          <div className='space-y-1'>
            <Label htmlFor={`eot-narrative-${claimId}`}>
              Supporting analysis
            </Label>
            <Textarea
              id={`eot-narrative-${claimId}`}
              rows={6}
              value={narrative}
              onChange={(event) => setNarrative(event.target.value)}
              data-testid='uat-eot-narrative'
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor={`eot-letter-${claimId}`}>Claim letter</Label>
            <Textarea
              id={`eot-letter-${claimId}`}
              rows={8}
              value={letter}
              onChange={(event) => setLetter(event.target.value)}
              data-testid='uat-eot-letter'
            />
          </div>
          {claimStatus !== 'draft' && (
            <p className='flex items-center gap-1 text-xs text-muted-foreground'>
              <AlertTriangle className='h-3 w-3' /> The claim is {claimStatus};
              the text can only be applied to a draft claim.
            </p>
          )}
          <div className='flex flex-wrap items-center gap-2'>
            <AiRunFeedback
              projectId={projectId}
              messageId={result.message?.id ?? null}
              initial={result.message?.feedback ?? null}
              model={result.message?.model}
              className='mr-auto'
            />
            <Button size='sm' variant='ghost' onClick={() => setResult(null)}>
              Discard
            </Button>
            <Button
              size='sm'
              variant='outline'
              disabled={
                !canApply ||
                claimStatus !== 'draft' ||
                apply.isPending ||
                !narrative.trim()
              }
              onClick={() => applyPart('analysis')}
              data-testid='uat-eot-apply-analysis'
            >
              Use as analysis
            </Button>
            <Button
              size='sm'
              disabled={
                !canApply ||
                claimStatus !== 'draft' ||
                apply.isPending ||
                !letter.trim()
              }
              onClick={() => applyPart('claimLetter')}
              data-testid='uat-eot-apply-letter'
            >
              Use as claim letter
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
