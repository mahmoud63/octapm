import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
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
import { useChangeEvents } from '@/features/change-events/hooks/use-change-events'
import { useExceptionAction, type ProjectException } from './api'
import { kindLabel } from './exception-format'

/**
 * The review actions on one exception: review with a note, snooze until a
 * date, dismiss with a reason, associate an existing change event. Each is
 * offered only where the server's `actions` said this caller may (the
 * screen checks before opening this); the server decides again on POST.
 * None of them changes a figure — they record a person's review.
 */

export type ExceptionDialogMode = 'review' | 'snooze' | 'dismiss' | 'associate'

const TITLE: Record<ExceptionDialogMode, string> = {
  review: 'Review exception',
  snooze: 'Snooze exception',
  dismiss: 'Dismiss exception',
  associate: 'Associate a change event',
}

const tomorrow = () => {
  const date = new Date()
  date.setDate(date.getDate() + 7)
  return date.toISOString().slice(0, 10)
}

function AssociatePicker({
  projectId,
  value,
  onChange,
}: {
  projectId: string
  value: string
  onChange: (value: string) => void
}) {
  const { data, isLoading, error } = useChangeEvents(projectId)
  const events = (data?.items ?? []).filter(
    (event) => !['converted', 'closed', 'void'].includes(event.status)
  )
  if (isLoading) return <p className='text-sm text-muted-foreground'>Loading change events…</p>
  if (error) {
    return (
      <p className='text-sm text-destructive' data-testid='exception-associate-error'>
        {getServerErrorMessage(error, 'Change events could not be read.')}
      </p>
    )
  }
  if (!events.length) {
    return (
      <p className='text-sm text-muted-foreground' data-testid='exception-associate-none'>
        No live change event on this project to associate.
      </p>
    )
  }
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-testid='exception-associate-select'>
        <SelectValue placeholder='Choose a change event' />
      </SelectTrigger>
      <SelectContent>
        {events.map((event) => (
          <SelectItem key={event.id} value={event.id}>
            {event.ref} · {event.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ExceptionActionDialog({
  projectId,
  exception,
  mode,
  onClose,
}: {
  projectId: string
  exception: ProjectException | null
  mode: ExceptionDialogMode | null
  onClose: () => void
}) {
  const action = useExceptionAction(projectId)
  const [note, setNote] = useState('')
  const [until, setUntil] = useState(tomorrow())
  const [changeEventId, setChangeEventId] = useState('')
  // The host remounts this dialog per exception and action (its `key`), so
  // each opening starts empty.
  const open = Boolean(exception && mode)

  const ready =
    mode === 'dismiss'
      ? note.trim().length > 0
      : mode === 'snooze'
        ? Boolean(until)
        : mode === 'associate'
          ? Boolean(changeEventId)
          : true

  const submit = async () => {
    if (!exception || !mode) return
    try {
      if (mode === 'review') {
        await action.mutateAsync({ action: 'review', exceptionId: exception.id, body: { note: note.trim() || null } })
        toast.success('Exception reviewed')
      } else if (mode === 'snooze') {
        await action.mutateAsync({
          action: 'snooze',
          exceptionId: exception.id,
          body: { until, note: note.trim() || null },
        })
        toast.success(`Exception snoozed until ${new Date(until).toLocaleDateString()}`)
      } else if (mode === 'dismiss') {
        await action.mutateAsync({ action: 'dismiss', exceptionId: exception.id, body: { reason: note.trim() } })
        toast.success('Exception dismissed')
      } else {
        await action.mutateAsync({
          action: 'associate-change-event',
          exceptionId: exception.id,
          body: { changeEventId },
        })
        toast.success('Change event associated')
      }
      onClose()
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className='sm:max-w-md' data-testid='exception-action-dialog' data-mode={mode ?? ''}>
        <DialogHeader>
          <DialogTitle>{mode ? TITLE[mode] : ''}</DialogTitle>
          <DialogDescription>
            {exception ? `${kindLabel(exception.kind)} · ${exception.subject.label ?? exception.subject.type}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          {mode === 'snooze' && (
            <div className='space-y-1'>
              <Label htmlFor='exception-snooze-until'>Snooze until</Label>
              <Input
                id='exception-snooze-until'
                type='date'
                value={until}
                onChange={(event) => setUntil(event.target.value)}
                data-testid='exception-snooze-until'
              />
            </div>
          )}
          {mode === 'associate' ? (
            <AssociatePicker projectId={projectId} value={changeEventId} onChange={setChangeEventId} />
          ) : (
            <div className='space-y-1'>
              <Label htmlFor='exception-note'>
                {mode === 'dismiss' ? 'Reason (required)' : 'Note'}
              </Label>
              <Textarea
                id='exception-note'
                rows={3}
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                data-testid='exception-note'
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready || action.isPending} onClick={submit} data-testid='exception-action-submit'>
            {action.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {mode ? TITLE[mode].split(' ')[0] : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
