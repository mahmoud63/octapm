import { useState } from 'react'
import { Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AiRunFeedback } from '@/features/assistant/components/ai-run-feedback'
import {
  useExplainScopeGaps,
  useScopeGaps,
  useSpecStatus,
  type SpecGap,
  type SpecGapReview,
} from '../hooks/use-specifications'

/** A BOQ figure the server withheld: "—", with the server's reason on hover. */
function Withheld({ reason }: { reason: string }) {
  return <span title={reason}>—</span>
}

const GAP_LABEL: Record<SpecGap, string> = {
  no_boq: 'no BOQ items',
  no_drawings: 'no drawings',
  no_activities: 'no activities',
}

/**
 * Scope coverage of the specification against the BOQ, the drawings and
 * the schedule — computed from the records; the review is the model's
 * reading of that computation.
 */
export function ScopeGapsCard({
  projectId,
  onOpenSection,
}: {
  projectId: string
  onOpenSection: (sectionId: string) => void
}) {
  const { data, isLoading, isFetching, refetch } = useScopeGaps(projectId)
  const { data: status } = useSpecStatus(projectId)
  const canAsk = useCanPerform('assistant', 'read')
  const explain = useExplainScopeGaps(projectId)
  const [review, setReview] = useState<SpecGapReview | null>(null)

  const run = async () => {
    try {
      const value = await explain.mutateAsync()
      setReview(value)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  if (isLoading || !data) {
    return (
      <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' /> Checking coverage…
      </div>
    )
  }

  const withGaps = data.sections.filter((section) => section.gaps.length)
  // The server leaves the BOQ side out for a member who may not read the
  // BOQ (boqWithheld); its reason is shown, never a figure.
  const boqReason = data.boqWithheld?.reason ?? null
  const tiles: Array<[string, number | null, string]> = [
    ['Sections', data.summary.sections, 'indexed'],
    ['With a gap', data.summary.withGaps, 'need a look'],
    ['No BOQ', data.summary.noBoq ?? null, 'sections unpriced?'],
    ['No drawings', data.summary.noDrawings, 'sections undrawn?'],
    ['No activities', data.summary.noActivities, 'sections unscheduled?'],
    [
      'BOQ uncovered',
      data.summary.uncoveredBoq ?? null,
      boqReason ? 'of the BOQ' : `of ${data.summary.boqItems} items`,
    ],
  ]

  return (
    <div className='space-y-3' data-testid='uat-scope-gaps'>
      <div className='flex flex-wrap items-center gap-2'>
        <div>
          <p className='font-medium'>Scope coverage</p>
          <p className='text-xs text-muted-foreground'>
            Each section matched to BOQ items, sheets and activities by its
            title keywords, the division&apos;s vocabulary, CSI codes and
            disciplines. Indicative — a miss is often a naming mismatch.
          </p>
        </div>
        <Button
          size='sm'
          variant='ghost'
          className='ml-auto'
          disabled={isFetching}
          onClick={() => refetch()}
        >
          <RefreshCw className='mr-1 h-3.5 w-3.5' /> Recompute
        </Button>
        {canAsk && status?.enabled && (
          <Button
            size='sm'
            variant='outline'
            disabled={explain.isPending}
            onClick={run}
            data-testid='uat-scope-gaps-explain'
          >
            {explain.isPending ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <Sparkles className='mr-2 h-4 w-4' />
            )}
            Review with AI
          </Button>
        )}
      </div>

      <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6'>
        {tiles.map(([label, value, hint]) => (
          <div key={label} className='rounded border p-3'>
            <p className='text-xs text-muted-foreground'>{label}</p>
            <p className='text-2xl font-bold tabular-nums'>
              {value === null ? <Withheld reason={boqReason ?? ''} /> : value}
            </p>
            <p className='text-[11px] text-muted-foreground'>{hint}</p>
          </div>
        ))}
      </div>

      {boqReason && (
        <p
          className='text-xs text-muted-foreground'
          data-testid='uat-scope-gaps-boq-withheld'
        >
          BOQ coverage — {boqReason}
        </p>
      )}

      {data.notes.length > 0 && (
        <ul className='space-y-0.5 rounded-md border border-dashed p-3 text-xs text-muted-foreground'>
          {data.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {review?.review && (
        <div
          className='space-y-2 rounded-md border p-3 text-sm'
          data-testid='uat-scope-gaps-review'
        >
          <p className='font-medium'>{review.review.headline}</p>
          <p className='whitespace-pre-wrap'>{review.review.narrative}</p>
          {review.review.actions.length > 0 && (
            <ul className='space-y-1 text-xs'>
              {review.review.actions.map((action, index) => (
                <li key={index} className='flex flex-wrap items-baseline gap-1'>
                  <Badge variant='outline' className='px-1 py-0 text-[10px]'>
                    {action.type === 'create_task'
                      ? 'suggested task'
                      : 'suggested RFI'}
                  </Badge>
                  <span>
                    {action.type === 'create_task'
                      ? action.title
                      : action.subject}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {review.degraded && (
            <p className='text-xs text-muted-foreground'>{review.reason}</p>
          )}
          {review.message && (
            <AiRunFeedback
              projectId={projectId}
              messageId={review.message.id}
              initial={review.message.feedback}
              model={review.message.model}
            />
          )}
        </div>
      )}

      {withGaps.length > 0 && (
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/50 text-xs text-muted-foreground'>
              <tr>
                <th className='px-2 py-1 text-left'>Section</th>
                <th className='px-2 py-1 text-right'>BOQ</th>
                <th className='px-2 py-1 text-right'>Sheets</th>
                <th className='px-2 py-1 text-right'>Activities</th>
                <th className='px-2 py-1 text-right'>RFIs</th>
                <th className='px-2 py-1 text-left'>Gaps</th>
              </tr>
            </thead>
            <tbody data-testid='uat-scope-gaps-rows'>
              {withGaps.map((section) => (
                <tr
                  key={section.id}
                  className='cursor-pointer border-t hover:bg-muted/40'
                  onClick={() => onOpenSection(section.id)}
                >
                  <td className='px-2 py-1'>
                    <span className='font-mono text-xs'>{section.code}</span>{' '}
                    {section.title}
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {section.counts.boq ?? (
                      <Withheld reason={boqReason ?? ''} />
                    )}
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {section.counts.sheets}
                    {section.counts.sheetsByDiscipline >
                      section.counts.sheets && (
                      <span className='text-muted-foreground'>
                        {' '}
                        (+
                        {section.counts.sheetsByDiscipline -
                          section.counts.sheets}
                        )
                      </span>
                    )}
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {section.counts.activities}
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {section.counts.rfis}
                  </td>
                  <td className='px-2 py-1'>
                    <span className='flex flex-wrap gap-1'>
                      {section.gaps.map((gap) => (
                        <Badge
                          key={gap}
                          variant='outline'
                          className='border-amber-300 px-1 py-0 text-[10px] text-amber-700 dark:text-amber-300'
                        >
                          {GAP_LABEL[gap]}
                        </Badge>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {((data.uncoveredBoq?.length ?? 0) > 0 ||
        data.uncoveredDisciplines.length > 0) && (
        <div className='grid gap-3 md:grid-cols-2'>
          {data.uncoveredBoq && data.uncoveredBoq.length > 0 && (
            <div className='rounded-md border p-3 text-sm'>
              <p className='mb-1 text-xs font-medium text-muted-foreground'>
                BOQ items no section covers · {data.summary.uncoveredBoq}
              </p>
              <ul className='max-h-64 space-y-0.5 overflow-auto text-xs'>
                {data.uncoveredBoq.map((item) => (
                  <li key={item.id}>
                    <span className='font-mono'>{item.code ?? '—'}</span>{' '}
                    {item.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.uncoveredDisciplines.length > 0 && (
            <div className='rounded-md border p-3 text-sm'>
              <p className='mb-1 text-xs font-medium text-muted-foreground'>
                Drawings without a specification
              </p>
              <ul className='space-y-0.5 text-xs'>
                {data.uncoveredDisciplines.map((row) => (
                  <li key={row.discipline}>
                    {row.sheets} {row.discipline} sheet
                    {row.sheets === 1 ? '' : 's'} — no section for that
                    discipline is indexed.
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
