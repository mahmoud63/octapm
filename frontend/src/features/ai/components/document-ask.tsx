import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CitedText } from '@/features/assistant/components/assistant-sheet'
import type { AssistantCitation } from '@/features/assistant/hooks/use-assistant'
import {
  useAskDocuments,
  type DocumentAnswer,
  type DocumentPassage,
} from '../hooks/use-document-qa'

const passageLabel = (passage: DocumentPassage) =>
  `${passage.ref ? `${passage.ref} · ` : ''}${passage.title} · passage ${passage.chunkIndex + 1}`

const asCitation = (passage: DocumentPassage): AssistantCitation => ({
  n: passage.n,
  id: passage.documentId,
  type: 'document',
  typeLabel: 'Document',
  title: passageLabel(passage),
  ref: passage.ref,
  projectId: null,
  projectName: null,
  url: null,
  snippet: passage.snippet,
})

function Answer({ result }: { result: DocumentAnswer }) {
  const shown = result.answer?.citations.length ? result.answer.citations : result.passages
  return (
    <div className='space-y-2 rounded-md bg-muted/40 p-3 text-sm' data-testid='uat-document-answer'>
      {result.answer ? (
        <>
          <p className='text-[10px] font-semibold tracking-wide text-muted-foreground uppercase'>
            AI interpretation{result.answer.mock ? ' · mock model' : ''}
          </p>
          <CitedText content={result.answer.text} citations={result.answer.citations.map(asCitation)} />
        </>
      ) : result.insufficient ? (
        <p className='text-muted-foreground'>
          The documents searched do not say. No passage matches the question
          {result.notIndexed.length ? '; some files are not indexed yet' : ''}.
        </p>
      ) : (
        <p className='text-muted-foreground'>
          {result.degradedReason === 'AI_NOT_CONFIGURED'
            ? 'AI is not configured; here are the passages that match.'
            : 'The AI provider did not answer; here are the passages that match.'}
        </p>
      )}
      {shown.length > 0 && (
        <ol className='space-y-1.5 text-xs'>
          {shown.map((passage) => (
            <li key={passage.n} className='rounded border bg-background p-2'>
              <p className='font-medium'>
                [{passage.n}] {passageLabel(passage)}
              </p>
              <p className='line-clamp-3 text-muted-foreground'>{passage.snippet}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * Ask a question of the project's documents, or of one document, inside
 * the Documents module (AI-6). The server decides which documents the
 * caller may read before any passage is read.
 */
export interface DocumentAskPreset {
  label: string
  question: string
  mode: 'answer' | 'summary' | 'compare'
}

export function DocumentAsk({
  projectId,
  documentId,
  documentIds,
  documentTitle,
  presets = [],
  autoRun = null,
  className,
}: {
  projectId: string
  documentId?: string
  /** Several documents (Compare Documents). */
  documentIds?: string[]
  documentTitle?: string
  /** One-click questions shown beside the box (Summarize…). */
  presets?: DocumentAskPreset[]
  /** Asked as soon as the box opens. */
  autoRun?: DocumentAskPreset | null
  className?: string
}) {
  const canAsk = useCanPerform('assistant', 'read')
  const ask = useAskDocuments(projectId)
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<DocumentAnswer | null>(null)
  const ids = documentIds ?? (documentId ? [documentId] : undefined)
  const idsKey = (ids ?? []).join(',')
  const ran = useRef<string | null>(null)

  const run = async (text: string, mode: DocumentAskPreset['mode'] = 'answer') => {
    if (text.trim().length < 3) return
    try {
      setResult(await ask.mutateAsync({ question: text.trim(), documentIds: ids, mode }))
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  useEffect(() => {
    if (!autoRun || !canAsk || ran.current === idsKey) return
    ran.current = idsKey
    void run(autoRun.question, autoRun.mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, autoRun, canAsk])

  if (!canAsk) return null
  const submit = () => run(question)

  return (
    <div className={cn('space-y-2', className)} data-testid={ids ? 'uat-document-ask-one' : 'uat-document-ask'}>
      <div className='flex items-center gap-2'>
        <Sparkles className='h-4 w-4 shrink-0 text-primary' aria-hidden />
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
          placeholder={documentTitle ? `Ask ${documentTitle}…` : 'Ask the project documents, e.g. "What glazing does the specification require?"'}
          maxLength={1000}
          aria-label={documentTitle ? `Ask ${documentTitle}` : 'Ask the project documents'}
        />
        <Button size='sm' onClick={() => void submit()} disabled={ask.isPending || question.trim().length < 3}>
          {ask.isPending ? <Loader2 className='h-4 w-4 animate-spin' /> : 'Ask'}
        </Button>
      </div>
      {presets.length > 0 && (
        <div className='flex flex-wrap gap-1.5'>
          {presets.map((preset) => (
            <Button
              key={preset.label}
              size='sm'
              variant='outline'
              className='h-7 px-2 text-xs'
              disabled={ask.isPending}
              onClick={() => void run(preset.question, preset.mode)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      )}
      {result && <Answer result={result} />}
      {result && result.notIndexed.length > 0 && (
        <p className='text-xs text-muted-foreground'>
          Not indexed yet:{' '}
          {result.notIndexed.map((item) => (
            <Badge key={item.documentId} variant='outline' className='mr-1'>
              {item.title}
            </Badge>
          ))}
        </p>
      )}
    </div>
  )
}
