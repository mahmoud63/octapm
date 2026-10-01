import { useState } from 'react'
import { FilePlus2 } from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import type { ChangeEventSource } from './api'
import { RaiseChangeEventDialog } from './raise-change-event-dialog'

/**
 * "Raise change event" on a source record (change intelligence §2, §5):
 * an RFI, a daily log, an NCR, a punch item, a drawing revision, a submittal
 * or a meeting action. The button is drawn only where the server's
 * permission matrix grants this person change_event create on the project;
 * pressing it asks the server for the prefill, and a record the server will
 * not raise from is refused in its words. Saving creates a draft change
 * event with the typed source link — never a change order.
 *
 * (The exceptions screen does not use this button: an exception carries its
 * own `actions.raiseChangeEvent` boolean, and that decides.)
 */
export function RaiseChangeEventButton({
  projectId,
  source,
  testId,
  className,
}: {
  projectId: string
  source: ChangeEventSource
  testId: string
  className?: string
}) {
  const allowed = useCanPerform('change_event', 'create')
  const [open, setOpen] = useState(false)
  if (!allowed) return null
  return (
    <>
      <Button
        size='sm'
        variant='outline'
        className={className}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
        data-testid={testId}
        data-source-type={source.type}
      >
        <FilePlus2 className='mr-1.5 h-4 w-4' /> Raise change event
      </Button>
      <RaiseChangeEventDialog
        projectId={projectId}
        source={open ? source : null}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
