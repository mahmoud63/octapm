import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  CHANGE_EVENT_TYPE_LABEL,
  changeEventOriginLabel,
  type ChangeEventType,
} from '@/features/change-events/hooks/use-change-events'
import { formatQuantity } from '../lib/detail-format'
import {
  useChangeEventPrefill,
  useRaiseChangeEvent,
  withoutAmounts,
  type ChangeEventPrefill,
  type ChangeEventSource,
} from './api'

/**
 * Raise change event (change intelligence §2): the change-event create form,
 * opened PREFILLED from the server's prefill for the source — an exception,
 * an RFI, a daily log, an NCR, a punch item, a drawing revision, a
 * submittal or a meeting action (GET <source>/:id/change-event-prefill).
 * The server proposes the origin, the activity and location and the lines
 * with their quantity; the person may change the wording and the type. The
 * amount is blank and stays blank — pricing is the QS's, on the event.
 * Saving POSTs the source's raise endpoint, which creates ONE DRAFT change
 * event with the typed link to the source (the web never sends the link)
 * by this person's explicit action; nothing here creates a change order or
 * moves a budget or a schedule.
 */

const SOURCE_LABEL: Record<ChangeEventSource['type'], string> = {
  exception: 'Exception',
  rfi: 'RFI',
  daily_log: 'Daily log',
  ncr: 'NCR',
  punch_item: 'Punch item',
  drawing_revision: 'Drawing revision',
  submittal: 'Submittal',
  meeting_action: 'Meeting action',
}

type LineDraft = { key: string; base: Record<string, unknown>; description: string }

const text = (value: unknown) => (typeof value === 'string' ? value : '')

export function RaiseChangeEventDialog({
  projectId,
  source,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string
  source: ChangeEventSource | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (event: { id: string; ref: string }) => void
}) {
  const { data: prefill, isLoading, error } = useChangeEventPrefill(
    projectId,
    open ? source : null
  )
  const raise = useRaiseChangeEvent(projectId)
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [type, setType] = useState<ChangeEventType>('other')
  const [description, setDescription] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([])
  // The form starts from each prefill the server answers (set while
  // rendering when it arrives, the React pattern for state that follows a
  // prop) — the person's edits stay until the next prefill.
  const [seen, setSeen] = useState<ChangeEventPrefill | null>(null)
  if (prefill && prefill !== seen) {
    setSeen(prefill)
    const proposed = prefill.prefill
    setTitle(text(proposed.title))
    setType(
      proposed.type && proposed.type in CHANGE_EVENT_TYPE_LABEL
        ? (proposed.type as ChangeEventType)
        : 'other'
    )
    setDescription(text(proposed.description))
    setLines(
      (proposed.lines ?? []).map((line, index) => ({
        key: `${index}`,
        base: withoutAmounts(line),
        description: text(line.description),
      }))
    )
  }

  const proposedDraft = prefill?.prefill ?? {}
  const sourceLabel = source ? SOURCE_LABEL[source.type] : ''

  const save = async () => {
    if (!prefill || !source) return
    try {
      // Only what a person may set over the prefill: the words, the type and
      // the lines — every amount stripped. Origin, activity, location and the
      // typed link stay the endpoint's.
      const created = await raise.mutateAsync({
        source,
        body: {
          title: title.trim(),
          type,
          description: description.trim() || null,
          lines: lines.map((line) => ({
            ...withoutAmounts(line.base),
            description: line.description.trim() || text(line.base.description),
          })),
        },
      })
      onOpenChange(false)
      onCreated?.(created)
      toast.success(`${created.ref} created as a draft change event — price it on the event`, {
        action: {
          label: 'Open',
          onClick: () =>
            navigate({
              to: '/projects/$projectId/$module/$child',
              params: { projectId, module: 'commercial', child: 'change-events' },
              search: { recordId: created.id, source: 'change_event' },
            }),
        },
      })
    } catch (failure) {
      toast.error(getServerErrorMessage(failure))
    }
  }

  const refused = (error as { response?: { data?: { error?: { message?: string } } } } | null)
    ?.response?.data?.error?.message

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-2xl'
        data-testid='raise-change-event-dialog'
        data-source-type={source?.type ?? ''}
        data-source-id={source?.id ?? ''}
      >
        <DialogHeader>
          <DialogTitle>Raise change event</DialogTitle>
          <DialogDescription>
            A draft change event, prefilled from the {sourceLabel || 'source record'}. The
            amount is left blank for the QS to price on the event; no change order is created.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className='flex items-center gap-2 py-6 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Reading the prefill…
          </div>
        ) : error || !prefill ? (
          <p className='text-sm text-destructive' data-testid='raise-change-event-refused'>
            {refused ?? 'The server did not give a prefill for this record.'}
          </p>
        ) : (
          <div className='space-y-3' data-testid='raise-change-event-form'>
            <div className='flex flex-wrap gap-2 text-xs'>
              {source && (
                <Badge variant='outline' data-testid='raise-change-event-source'>
                  From {SOURCE_LABEL[source.type]}
                </Badge>
              )}
              {typeof proposedDraft.origin === 'string' && (
                <Badge variant='outline' data-testid='raise-change-event-origin'>
                  Origin {changeEventOriginLabel(proposedDraft.origin)}
                </Badge>
              )}
              <Badge variant='secondary'>Draft</Badge>
            </div>
            <div className='space-y-1'>
              <Label htmlFor='raise-ce-title'>Title</Label>
              <Input
                id='raise-ce-title'
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                data-testid='raise-change-event-title'
              />
            </div>
            <div className='space-y-1'>
              <Label>Type</Label>
              <Select value={type} onValueChange={(value) => setType(value as ChangeEventType)}>
                <SelectTrigger data-testid='raise-change-event-type'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CHANGE_EVENT_TYPE_LABEL) as ChangeEventType[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {CHANGE_EVENT_TYPE_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1'>
              <Label htmlFor='raise-ce-description'>Description</Label>
              <Textarea
                id='raise-ce-description'
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                data-testid='raise-change-event-description'
              />
            </div>
            <div className='space-y-1'>
              <p className='text-xs font-medium text-muted-foreground'>Lines (from the source)</p>
              {lines.length ? (
                <table className='w-full text-sm' data-testid='raise-change-event-lines'>
                  <thead className='text-left text-xs text-muted-foreground'>
                    <tr>
                      <th className='py-1 pr-2 font-medium'>Description</th>
                      <th className='py-1 pr-2 text-right font-medium'>Quantity</th>
                      <th className='py-1 text-right font-medium'>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => (
                      <tr key={line.key} className='border-t align-top'>
                        <td className='py-1 pr-2'>
                          <Input
                            value={line.description}
                            onChange={(event) =>
                              setLines((current) =>
                                current.map((row) =>
                                  row.key === line.key ? { ...row, description: event.target.value } : row
                                )
                              )
                            }
                            data-testid={`raise-change-event-line-${index}`}
                          />
                        </td>
                        <td className='py-1 pr-2 text-right tabular-nums' data-testid={`raise-change-event-line-qty-${index}`}>
                          {typeof line.base.quantity === 'number' ? formatQuantity(line.base.quantity) : '—'}
                          {typeof line.base.unit === 'string' && line.base.unit ? ` ${line.base.unit}` : ''}
                        </td>
                        <td
                          className='py-1 text-right text-xs text-muted-foreground'
                          data-testid={`raise-change-event-line-amount-${index}`}
                          data-amount-blank='true'
                        >
                          — for the QS
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  The server proposed no lines; add them on the event.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!prefill || !title.trim() || raise.isPending}
            onClick={save}
            data-testid='raise-change-event-save'
          >
            {raise.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Create draft change event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
