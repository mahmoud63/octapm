import { Landmark, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  SYNC_STATUS_LABEL,
  useProjectAccountingConnections,
  useProjectAccountingSyncs,
  useRetryProjectAccountingSync,
  useSyncPayAppToAccounting,
} from '../hooks/use-integrations'

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : '—'

/**
 * Accounting status of one pay application: posted bills per provider,
 * with "Send to accounting" for accounting approvers on approved
 * applications. Renders nothing when no accounting system is connected.
 */
export function PayAppAccounting({
  projectId,
  payAppId,
  status,
}: {
  projectId: string
  payAppId: string
  status: string
}) {
  const canSync = useCanPerform(
    'sub_pay_app',
    'update',
    'sub_pay_app.accounting_sync'
  )
  const { data: connections = [] } = useProjectAccountingConnections(projectId)
  const connected = connections.filter((item) => item.status === 'connected')
  const { data: syncs = [] } = useProjectAccountingSyncs(
    projectId,
    connected.length ? payAppId : null
  )
  const send = useSyncPayAppToAccounting(projectId)
  const retry = useRetryProjectAccountingSync(projectId)
  if (connected.length === 0) return null
  const mine = syncs.filter((item) => item.recordId === payAppId)
  const canSend =
    canSync &&
    ['approved', 'paid'].includes(status) &&
    connected.some(
      (connection) =>
        !mine.some(
          (sync) =>
            sync.provider === connection.provider &&
            ['pending', 'synced', 'paid'].includes(sync.status)
        )
    )

  return (
    <section
      className='space-y-2 rounded-md border p-3'
      data-testid='uat-pay-app-accounting'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <h4 className='flex items-center gap-2 text-sm font-semibold'>
          <Landmark className='h-4 w-4' />
          Accounting
        </h4>
        {canSend && (
          <Button
            size='sm'
            variant='outline'
            className='ml-auto'
            disabled={send.isPending}
            data-testid='uat-pay-app-send-accounting'
            onClick={async () => {
              try {
                await send.mutateAsync({ payAppId })
                toast.success('Sent to accounting — the bill is being created')
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {send.isPending && (
              <Loader2 className='mr-1 h-3 w-3 animate-spin' />
            )}
            Send to accounting
          </Button>
        )}
      </div>
      {mine.length === 0 ? (
        <p className='text-xs text-muted-foreground'>
          {['approved', 'paid'].includes(status)
            ? `Not posted to ${connected.map((item) => item.label).join(' / ')} yet.`
            : 'Posted to accounting once approved.'}
        </p>
      ) : (
        <ul className='space-y-1 text-xs'>
          {mine.map((sync) => (
            <li
              key={sync.id}
              className='flex flex-wrap items-center gap-2'
              data-testid={`uat-pay-app-sync-${sync.status}`}
            >
              <span>{sync.providerLabel}</span>
              <Badge
                variant={
                  sync.status === 'failed'
                    ? 'destructive'
                    : sync.status === 'paid'
                      ? 'default'
                      : 'outline'
                }
              >
                {SYNC_STATUS_LABEL[sync.status]}
              </Badge>
              {sync.externalRef && (
                <span className='text-muted-foreground'>
                  bill {sync.externalRef}
                </span>
              )}
              {sync.syncedAt && (
                <span className='text-muted-foreground'>
                  posted {formatDate(sync.syncedAt)}
                </span>
              )}
              {sync.paidAt && (
                <span className='text-muted-foreground'>
                  paid {formatDate(sync.paidAt)}
                </span>
              )}
              {sync.lastError && (
                <span className='w-full text-destructive'>
                  {sync.lastError}
                </span>
              )}
              {sync.status === 'failed' && canSync && (
                <Button
                  size='sm'
                  variant='ghost'
                  className='h-6 px-2'
                  disabled={retry.isPending}
                  onClick={async () => {
                    try {
                      await retry.mutateAsync(sync.id)
                      toast.success('Queued again')
                    } catch (error) {
                      toast.error(getServerErrorMessage(error))
                    }
                  }}
                >
                  Retry
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
