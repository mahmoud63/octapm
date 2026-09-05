import { useState } from 'react'
import {
  AlertTriangle,
  Camera,
  Loader2,
  Mic,
  Sparkles,
  Square,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { AiRunFeedback } from '@/features/assistant/components/ai-run-feedback'
import type { DailyLog } from '../hooks/use-daily-log'
import {
  useApplyDailyLogDraft,
  useAudioRecorder,
  useDailyLogAiStatus,
  useDraftDailyLog,
  useSpeechDictation,
  useTranscribeAudio,
  type DailyLogDraftResult,
} from '../hooks/use-daily-log-assistant'

type Selection = {
  useSummary: boolean
  summary: string
  notes: boolean[]
  delays: boolean[]
  captions: boolean[]
}

const selectionFor = (
  result: DailyLogDraftResult,
  log: DailyLog
): Selection => ({
  useSummary: !log.summary,
  summary: result.draft.summary,
  notes: result.draft.notes.map(() => true),
  delays: result.draft.delays.map(() => true),
  captions: result.draft.photoCaptions.map((caption) => !caption.existing),
})

const CONFIDENCE_LABEL = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'From the records only',
} as const

const count = (value: number, one: string, many = `${one}s`) =>
  `${value} ${value === 1 ? one : many}`

function CheckRow({
  checked,
  onChange,
  children,
  testId,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: React.ReactNode
  testId?: string
}) {
  return (
    <label className='flex items-start gap-2 text-sm'>
      <input
        type='checkbox'
        className='mt-1 h-3.5 w-3.5 accent-primary'
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        data-testid={testId}
      />
      <span className='min-w-0 flex-1'>{children}</span>
    </label>
  )
}

/**
 * "Draft today's report": the day's records, photos (sent as images when the
 * provider reads them) and dictated notes become a proposed summary, notes,
 * delays and photo captions. Everything is a checkbox; nothing is written
 * until *Apply selected*.
 */
export function DailyLogDraftAssistant({
  projectId,
  date,
  log,
}: {
  projectId: string
  date: string
  log: DailyLog
}) {
  const { data: status } = useDailyLogAiStatus(projectId)
  const draft = useDraftDailyLog(projectId)
  const apply = useApplyDailyLogDraft(projectId)
  const transcribe = useTranscribeAudio(projectId)
  const [notes, setNotes] = useState('')
  const [interim, setInterim] = useState('')
  const [includePhotos, setIncludePhotos] = useState(true)
  const [state, setState] = useState<{
    result: DailyLogDraftResult
    selection: Selection
  } | null>(null)

  const appendNotes = (text: string) =>
    setNotes((previous) => (previous ? `${previous.trimEnd()} ${text}` : text))
  const dictation = useSpeechDictation({
    onFinal: appendNotes,
    onInterim: setInterim,
  })
  const recorder = useAudioRecorder({
    onRecording: async (blob) => {
      try {
        const spoken = await transcribe.mutateAsync({ blob })
        if (spoken.text) appendNotes(spoken.text)
        else toast.error('Nothing was heard in that recording')
      } catch (error) {
        toast.error(getServerErrorMessage(error))
      }
    },
  })
  const enabled = status?.enabled !== false
  const canRecord =
    !dictation.supported && Boolean(status?.transcription) && recorder.supported

  const run = async () => {
    try {
      const result = await draft.mutateAsync({
        date,
        notes: notes.trim() || null,
        includePhotos: includePhotos && Boolean(status?.vision),
      })
      setState({ result, selection: selectionFor(result, log) })
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const update = (patch: Partial<Selection>) =>
    setState((previous) =>
      previous
        ? { ...previous, selection: { ...previous.selection, ...patch } }
        : previous
    )
  const toggle = (key: 'notes' | 'delays' | 'captions', index: number) =>
    setState((previous) => {
      if (!previous) return previous
      const list = [...previous.selection[key]]
      list[index] = !list[index]
      return { ...previous, selection: { ...previous.selection, [key]: list } }
    })

  const applySelected = async () => {
    if (!state) return
    const { result, selection } = state
    const payload = {
      ...(selection.useSummary && selection.summary.trim()
        ? { summary: selection.summary.trim() }
        : {}),
      notes: result.draft.notes.filter((_, index) => selection.notes[index]),
      delays: result.draft.delays.filter((_, index) => selection.delays[index]),
      photoCaptions: result.draft.photoCaptions
        .filter((_, index) => selection.captions[index])
        .map((caption) => ({
          photoId: caption.photoId,
          caption: caption.caption,
        })),
      overwriteCaptions: true,
    }
    try {
      const outcome = await apply.mutateAsync({ date, payload })
      const parts = [
        outcome.applied.summary ? 'summary' : null,
        outcome.applied.notes ? count(outcome.applied.notes, 'note') : null,
        outcome.applied.delays ? count(outcome.applied.delays, 'delay') : null,
        outcome.applied.captions
          ? count(outcome.applied.captions, 'caption')
          : null,
      ].filter(Boolean)
      toast.success(
        parts.length ? `Applied: ${parts.join(', ')}` : 'Nothing was selected'
      )
      setState(null)
      setNotes('')
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const result = state?.result ?? null
  const selection = state?.selection ?? null
  const photosByRef = new Map(
    (result?.evidence.photos ?? []).map((photo) => [photo.ref, photo])
  )

  return (
    <section
      className='space-y-3 rounded-md border border-dashed bg-card p-3'
      data-testid='uat-dailylog-ai'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <Sparkles className='h-4 w-4 text-primary' />
        <h4 className='text-sm font-semibold'>Draft today&apos;s report</h4>
        <span className='text-xs text-muted-foreground'>
          {enabled
            ? 'From what was logged, progress, inspections, items raised, photos and your notes. You choose what to keep.'
            : 'No AI provider on this server — the draft is built from the day’s records only.'}
        </span>
      </div>

      <div className='space-y-2'>
        <Textarea
          rows={3}
          value={interim ? `${notes}${notes ? ' ' : ''}${interim}` : notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder='Say or type what happened today: who did what, where, problems, visitors, anything not in the records'
          data-testid='uat-dailylog-ai-notes'
        />
        <div className='flex flex-wrap items-center gap-2'>
          {dictation.supported && (
            <Button
              size='sm'
              variant={dictation.listening ? 'destructive' : 'outline'}
              onClick={() =>
                dictation.listening ? dictation.stop() : dictation.start()
              }
              data-testid='uat-dailylog-ai-dictate'
            >
              {dictation.listening ? (
                <Square className='mr-1.5 h-4 w-4' />
              ) : (
                <Mic className='mr-1.5 h-4 w-4' />
              )}
              {dictation.listening ? 'Stop dictating' : 'Dictate'}
            </Button>
          )}
          {canRecord && (
            <Button
              size='sm'
              variant={recorder.recording ? 'destructive' : 'outline'}
              disabled={transcribe.isPending}
              onClick={() =>
                recorder.recording ? recorder.stop() : recorder.start()
              }
              data-testid='uat-dailylog-ai-record'
            >
              {transcribe.isPending ? (
                <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
              ) : recorder.recording ? (
                <Square className='mr-1.5 h-4 w-4' />
              ) : (
                <Mic className='mr-1.5 h-4 w-4' />
              )}
              {recorder.recording
                ? 'Stop recording'
                : transcribe.isPending
                  ? 'Transcribing…'
                  : 'Record a voice note'}
            </Button>
          )}
          {status?.vision && (
            <label className='flex items-center gap-2 text-xs'>
              <Switch
                checked={includePhotos}
                onCheckedChange={setIncludePhotos}
                data-testid='uat-dailylog-ai-photos'
              />
              <Camera className='h-3.5 w-3.5' /> Look at today&apos;s photos (up
              to {status.maxPhotos})
            </label>
          )}
          <Button
            size='sm'
            className='ml-auto'
            disabled={draft.isPending}
            onClick={run}
            data-testid='uat-dailylog-ai-draft'
          >
            {draft.isPending ? (
              <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
            ) : (
              <Wand2 className='mr-1.5 h-4 w-4' />
            )}
            Draft the report
          </Button>
        </div>
      </div>

      {result && selection && (
        <div
          className='space-y-3 rounded border p-3'
          data-testid='uat-dailylog-ai-result'
        >
          <div className='flex flex-wrap items-center gap-2'>
            <Badge
              variant={
                result.draft.confidence === 'high'
                  ? 'default'
                  : result.draft.confidence === 'medium'
                    ? 'secondary'
                    : 'outline'
              }
            >
              {CONFIDENCE_LABEL[result.draft.confidence]}
            </Badge>
            <span className='text-xs text-muted-foreground'>
              {[
                count(result.evidence.counts.entries, 'entry', 'entries'),
                count(result.evidence.counts.progress, 'progress update'),
                count(result.evidence.counts.inspections, 'inspection'),
                count(
                  result.evidence.counts.punch,
                  'item raised',
                  'items raised'
                ),
                count(result.evidence.counts.safety, 'incident'),
                `${count(result.evidence.counts.photos, 'photo')}${result.evidence.includedImages ? ` (${result.evidence.includedImages} looked at)` : ''}`,
              ].join(' · ')}
            </span>
          </div>
          {result.degraded && (
            <Alert>
              <AlertTriangle className='h-4 w-4' />
              <AlertTitle>Built from the records only</AlertTitle>
              <AlertDescription>{result.reason}</AlertDescription>
            </Alert>
          )}

          <div className='space-y-1'>
            <CheckRow
              checked={selection.useSummary}
              onChange={(checked) => update({ useSummary: checked })}
              testId='uat-dailylog-ai-use-summary'
            >
              <span className='font-medium'>
                {log.summary
                  ? 'Replace the day’s summary'
                  : 'Set the day’s summary'}
              </span>
            </CheckRow>
            <Textarea
              rows={5}
              value={selection.summary}
              onChange={(event) => update({ summary: event.target.value })}
              disabled={!selection.useSummary}
              data-testid='uat-dailylog-ai-summary'
            />
          </div>

          {result.draft.workPerformed.length > 0 && (
            <div className='text-xs'>
              <p className='font-medium text-muted-foreground'>
                Work performed
              </p>
              <ul className='list-disc space-y-0.5 pl-4'>
                {result.draft.workPerformed.map((item, index) => (
                  <li key={index}>
                    {item.text}
                    {item.activity ? ` — ${item.activity}` : ''}
                    {item.sources.length ? (
                      <span className='text-muted-foreground'>
                        {' '}
                        [{item.sources.join(', ')}]
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.draft.notes.length > 0 && (
            <div className='space-y-1'>
              <p className='text-xs font-medium text-muted-foreground'>
                Notes to add
              </p>
              {result.draft.notes.map((note, index) => (
                <CheckRow
                  key={index}
                  checked={selection.notes[index]}
                  onChange={() => toggle('notes', index)}
                  testId='uat-dailylog-ai-note'
                >
                  <Badge variant='outline' className='mr-1.5 text-[10px]'>
                    {note.kind}
                  </Badge>
                  {note.text}
                </CheckRow>
              ))}
            </div>
          )}

          {result.draft.delays.length > 0 && (
            <div className='space-y-1'>
              <p className='text-xs font-medium text-muted-foreground'>
                Delays to add
              </p>
              {result.draft.delays.map((delay, index) => (
                <CheckRow
                  key={index}
                  checked={selection.delays[index]}
                  onChange={() => toggle('delays', index)}
                  testId='uat-dailylog-ai-delay'
                >
                  <Badge variant='outline' className='mr-1.5 text-[10px]'>
                    {delay.type}
                  </Badge>
                  {delay.description}
                  {delay.hoursLost ? ` · ${delay.hoursLost} h lost` : ''}
                </CheckRow>
              ))}
            </div>
          )}

          {result.draft.photoCaptions.length > 0 && (
            <div className='space-y-1'>
              <p className='text-xs font-medium text-muted-foreground'>
                Photo captions
              </p>
              <div className='grid gap-2 sm:grid-cols-2'>
                {result.draft.photoCaptions.map((caption, index) => {
                  const photo = photosByRef.get(caption.ref)
                  return (
                    <div
                      key={caption.photoId}
                      className={cn(
                        'flex gap-2 rounded border p-2',
                        !selection.captions[index] && 'opacity-60'
                      )}
                    >
                      {photo && (
                        <img
                          src={photo.thumbnailUrl}
                          alt={caption.ref}
                          loading='lazy'
                          className='h-14 w-14 shrink-0 rounded object-cover'
                        />
                      )}
                      <CheckRow
                        checked={selection.captions[index]}
                        onChange={() => toggle('captions', index)}
                        testId='uat-dailylog-ai-caption'
                      >
                        <span className='text-xs font-medium text-muted-foreground'>
                          {caption.ref}
                          {photo?.locationName
                            ? ` · ${photo.locationName}`
                            : ''}
                        </span>
                        <br />
                        {caption.caption}
                        {caption.existing && (
                          <span className='block text-xs text-muted-foreground'>
                            replaces “{caption.existing}”
                          </span>
                        )}
                      </CheckRow>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {result.draft.missing.length > 0 && (
            <p className='text-xs text-amber-700 dark:text-amber-300'>
              Still to record: {result.draft.missing.join(' · ')}
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
            <Button size='sm' variant='ghost' onClick={() => setState(null)}>
              Discard
            </Button>
            <Button
              size='sm'
              disabled={apply.isPending}
              onClick={applySelected}
              data-testid='uat-dailylog-ai-apply'
            >
              {apply.isPending && (
                <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
              )}
              Apply selected
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
