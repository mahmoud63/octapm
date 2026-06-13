import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

export type WorkflowDecisionMode = 'approve' | 'reject'

export function WorkflowDecisionDialog({
  open,
  onOpenChange,
  mode,
  title,
  description,
  isPending,
  rejectLabel = 'Disapprove',
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: WorkflowDecisionMode
  title: string
  description?: string
  isPending?: boolean
  rejectLabel?: string
  onConfirm: (note: string) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const requiresReason = mode === 'reject'
  const actionLabel = mode === 'approve' ? 'Approve' : rejectLabel

  useEffect(() => {
    if (open) setNote('')
  }, [open, mode])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Textarea
          rows={4}
          placeholder={requiresReason ? 'Reason' : 'Comment'}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type='button'
            variant={mode === 'reject' ? 'destructive' : 'default'}
            disabled={isPending || (requiresReason && !note.trim())}
            onClick={async () => {
              await onConfirm(note.trim())
              onOpenChange(false)
            }}
          >
            {isPending ? 'Saving...' : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
