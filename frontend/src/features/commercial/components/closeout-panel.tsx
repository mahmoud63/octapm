import { useState } from 'react'
import { Check, CircleDashed, Loader2, Lock, MinusCircle } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useCloseout,
  useCloseoutDecision,
  useUpdateCloseoutItem,
  type CloseoutItem,
} from '../hooks/use-closeout'

/**
 * Closeout.
 *
 * The four derived checks come first and carry a padlock: they are read from
 * the punch register, the insurance on the commitment and the payment
 * applications, and there is nothing to tick — close the snags, file the
 * certificate, pay the application. Each says what it actually found, so the
 * next step is on the screen rather than in somebody's head.
 *
 * Anything required can be waived with a reason. The alternative is a person
 * ticking a box to get past the gate, which loses the record of what was
 * really outstanding.
 */

const ICON = {
  complete: Check,
  waived: MinusCircle,
  not_applicable: MinusCircle,
  outstanding: CircleDashed,
}

const TONE = {
  complete: 'text-success-foreground',
  waived: 'text-muted-foreground',
  not_applicable: 'text-muted-foreground',
  outstanding: 'text-warning-foreground',
}

export function CloseoutPanel({
  projectId,
  commitmentId,
}: {
  projectId: string
  commitmentId: string
}) {
  const closeout = useCloseout(projectId, commitmentId)
  const update = useUpdateCloseoutItem(projectId, commitmentId)
  const decide = useCloseoutDecision(projectId, commitmentId)
  const canManage = useCanPerform('commitment', 'update', 'closeout.manage')
  const canApprove = useCanPerform('commitment', 'approve', 'closeout.approve')

  const [waiving, setWaiving] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  if (closeout.isPending) {
    return (
      <div className='flex justify-center rounded-md border py-8'>
        <Loader2 className='size-5 animate-spin text-muted-foreground' />
      </div>
    )
  }
  if (!closeout.data) return null

  const data = closeout.data
  const done = data.status === 'complete'

  const mark = async (item: CloseoutItem, status: 'complete' | 'outstanding') => {
    try {
      await update.mutateAsync({ key: item.key, status })
      toast.success(status === 'complete' ? `${item.label} recorded` : `${item.label} reopened`)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const waive = async (item: CloseoutItem) => {
    if (!reason.trim()) {
      toast.error('Say why the requirement is being waived')
      return
    }
    try {
      await update.mutateAsync({ key: item.key, status: 'waived', waivedReason: reason.trim() })
      toast.success(`${item.label} waived`)
      setWaiving(null)
      setReason('')
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <div className='rounded-md border p-3' data-testid='uat-closeout'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p className='text-sm font-medium'>Closeout</p>
          <p className='text-xs text-muted-foreground'>
            {done
              ? 'Complete. The subcontract can be closed and the retention released.'
              : 'Everything required here must be settled before final payment and closing.'}
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-medium',
            data.ready
              ? 'bg-success/15 text-success-foreground'
              : 'bg-warning/15 text-warning-foreground'
          )}
          data-testid='uat-closeout-state'
        >
          {data.ready ? 'Ready' : `${data.summary.outstanding} outstanding`}
        </span>
      </div>

      <ul className='mt-3 divide-y'>
        {data.items.map((item) => {
          const Icon = ICON[item.status] ?? CircleDashed
          const derived = item.source === 'derived'
          return (
            <li key={item.key} className='py-2' data-testid={`uat-closeout-${item.key}`}>
              <div className='flex flex-wrap items-start justify-between gap-2'>
                <div className='min-w-0'>
                  <p className='flex items-center gap-1.5 text-sm'>
                    <Icon className={cn('size-4 shrink-0', TONE[item.status])} />
                    <span className={cn(item.status === 'waived' && 'text-muted-foreground')}>
                      {item.label}
                    </span>
                    {!item.required && (
                      <span className='text-[11px] text-muted-foreground'>optional</span>
                    )}
                    {derived && (
                      <Lock
                        className='size-3 text-muted-foreground'
                        aria-label='Read from the records'
                      />
                    )}
                  </p>
                  {/* What the check actually found, or why it was waived. */}
                  <p className='ps-5.5 text-[11px] text-muted-foreground'>
                    {item.waivedReason ? `Waived — ${item.waivedReason}` : item.detail}
                  </p>
                </div>

                {!done && canManage && (
                  <div className='flex shrink-0 gap-1'>
                    {!derived && item.status !== 'complete' && (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => mark(item, 'complete')}
                        data-testid={`uat-closeout-complete-${item.key}`}
                      >
                        Record
                      </Button>
                    )}
                    {!derived && item.status === 'complete' && (
                      <Button size='sm' variant='ghost' onClick={() => mark(item, 'outstanding')}>
                        Undo
                      </Button>
                    )}
                    {item.status !== 'waived' && item.required && (
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() => {
                          setWaiving(waiving === item.key ? null : item.key)
                          setReason('')
                        }}
                        data-testid={`uat-closeout-waive-${item.key}`}
                      >
                        Waive
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {waiving === item.key && (
                <div className='mt-2 flex flex-wrap gap-2 ps-5.5'>
                  <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder='Why is this being waived?'
                    className='min-w-56 flex-1'
                    data-testid='uat-closeout-waive-reason'
                  />
                  <Button
                    size='sm'
                    disabled={!reason.trim() || update.isPending}
                    onClick={() => waive(item)}
                    data-testid='uat-closeout-waive-save'
                  >
                    Waive
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {data.summary.retentionHeld > 0 && (
        <p className='mt-3 text-xs text-muted-foreground'>
          {data.currency}{' '}
          {data.summary.retentionHeld.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}{' '}
          of retention is still held.
        </p>
      )}

      {canApprove && (
        <div className='mt-3 flex flex-wrap gap-2'>
          {!done && (
            <Button
              size='sm'
              variant='outline'
              disabled={decide.isPending}
              onClick={async () => {
                try {
                  await decide.mutateAsync({ action: 'complete' })
                  toast.success('Closeout complete')
                } catch (error) {
                  toast.error(getServerErrorMessage(error))
                }
              }}
              data-testid='uat-closeout-complete'
            >
              Mark closeout complete
            </Button>
          )}
          {done && (
            <Button
              size='sm'
              variant='ghost'
              disabled={decide.isPending}
              onClick={async () => {
                try {
                  await decide.mutateAsync({ action: 'reopen', reason: 'Reopened for review' })
                  toast.success('Closeout reopened')
                } catch (error) {
                  toast.error(getServerErrorMessage(error))
                }
              }}
            >
              Reopen
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
