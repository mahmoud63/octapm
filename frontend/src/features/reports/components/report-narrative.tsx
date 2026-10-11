import { useState, type ReactNode } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Button } from '@/components/ui/button'
import { AiRunFeedback } from '@/features/assistant/components/ai-run-feedback'
import {
  useNarrateReport,
  type ReportNarrativeResult,
} from '../hooks/use-report-assistant'
import type { ReportDefinitionInput } from '../hooks/use-report-builder'

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className='pt-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase'>
      {children}
    </p>
  )
}

/** "Explain these numbers": a plain-language summary of the current preview. */
export function ReportNarrative({
  definition,
}: {
  definition: ReportDefinitionInput
}) {
  const narrate = useNarrateReport()
  const [result, setResult] = useState<ReportNarrativeResult | null>(null)

  const run = async () => {
    try {
      setResult(
        await narrate.mutateAsync({
          source: definition.source,
          projectId: definition.projectId ?? null,
          columns: definition.columns,
          filters: definition.filters,
          sort: definition.sort ?? null,
          groupBy: definition.groupBy ?? null,
          aggregates: definition.aggregates,
        })
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <div className='space-y-2' data-testid='uat-report-narrative'>
      <Button
        size='sm'
        variant='outline'
        disabled={narrate.isPending}
        onClick={run}
        data-testid='uat-report-narrate'
      >
        {narrate.isPending ? (
          <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
        ) : (
          <Sparkles className='mr-1.5 h-4 w-4' />
        )}
        Explain these numbers
      </Button>
      {result && (
        <div
          className='space-y-1.5 rounded-md border p-3 text-sm'
          data-testid='uat-report-narrative-result'
        >
          {/* AI-5: the builder's numbers (FACT) apart from the model's
              reading of them and its suggestions. */}
          <SectionLabel>Fact</SectionLabel>
          {(() => {
            const facts = result.facts ?? {
              headline: result.narrative.headline,
              items: result.narrative.highlights,
              caveats: result.narrative.caveats,
            }
            return (
              <>
                <p className='font-semibold'>{facts.headline}</p>
                {facts.items.length > 0 && (
                  <ul className='list-disc pl-4 text-xs'>
                    {facts.items.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                )}
                {facts.caveats.length > 0 && (
                  <ul className='list-disc pl-4 text-xs text-muted-foreground'>
                    {facts.caveats.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                )}
              </>
            )
          })()}
          {result.generatedBy === 'ai' && (
            <>
              <SectionLabel>AI interpretation</SectionLabel>
              <p className='font-medium'>{result.narrative.headline}</p>
              <p className='whitespace-pre-wrap'>{result.narrative.summary}</p>
              {result.narrative.highlights.length > 0 && (
                <ul className='list-disc pl-4 text-xs'>
                  {result.narrative.highlights.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          {(result.recommendations?.length ?? 0) > 0 && (
            <>
              <SectionLabel>AI recommendation</SectionLabel>
              <ul className='list-disc pl-4 text-xs'>
                {(result.recommendations ?? []).map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </>
          )}
          {result.degraded && (
            <p className='text-xs text-muted-foreground'>{result.reason}</p>
          )}
          <AiRunFeedback
            projectId={definition.projectId ?? null}
            messageId={result.message?.id ?? null}
            initial={result.message?.feedback ?? null}
            model={result.message?.model}
          />
        </div>
      )}
    </div>
  )
}
