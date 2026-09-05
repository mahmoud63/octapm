import { BellRing, Loader2, Smartphone, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { usePushDevice } from '../hooks/use-push'

/** Turns push on or off for this browser and lists the user's other devices. */
export function PushDeviceCard() {
  const { status, enable, disable, test, forget } = usePushDevice()
  const data = status.data
  const busy = enable.isPending || disable.isPending
  const reason = !data
    ? null
    : !data.supported
      ? 'This browser cannot receive push notifications. On iPhone, add OctaPM to the Home Screen first (iOS 16.4 or later).'
      : !data.configured
        ? 'Push is not set up on this server yet — ask your administrator to add the VAPID keys.'
        : data.permission === 'denied'
          ? 'Notifications are blocked for OctaPM in this browser. Allow them in the site settings, then try again.'
          : null

  return (
    <div className='rounded-lg border p-4' data-testid='uat-push-device'>
      <div className='flex flex-wrap items-center gap-3'>
        <BellRing className='h-5 w-5 text-muted-foreground' />
        <div className='min-w-0 flex-1'>
          <h3 className='text-sm font-medium'>Push on this device</h3>
          <p className='text-sm text-muted-foreground'>
            Assignments, mentions and approvals arrive even when OctaPM is
            closed.
          </p>
        </div>
        {status.isLoading ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : (
          <Switch
            checked={Boolean(data?.subscribed)}
            disabled={busy || Boolean(reason)}
            data-testid='uat-push-toggle'
            onCheckedChange={async (checked) => {
              try {
                if (checked) {
                  await enable.mutateAsync()
                  toast.success('Push notifications are on for this device')
                } else {
                  await disable.mutateAsync()
                  toast.success('Push notifications are off for this device')
                }
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          />
        )}
      </div>
      {reason && <p className='mt-2 text-xs text-muted-foreground'>{reason}</p>}
      {data?.subscribed && (
        <div className='mt-3 flex flex-wrap gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={test.isPending}
            data-testid='uat-push-test'
            onClick={async () => {
              try {
                const result = await test.mutateAsync()
                toast.success(
                  result.sent
                    ? 'Test notification sent'
                    : 'No device received the test'
                )
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            Send a test
          </Button>
        </div>
      )}
      {data && data.devices.length > 0 && (
        <ul className='mt-3 divide-y text-sm'>
          {data.devices.map((device) => (
            <li key={device.id} className='flex items-center gap-2 py-1.5'>
              <Smartphone className='h-4 w-4 text-muted-foreground' />
              <span className='min-w-0 flex-1 truncate'>
                {device.platform ? device.platform.toUpperCase() : 'Device'}
                {device.endpoint === data.endpoint ? ' · this browser' : ''}
              </span>
              <span className='text-xs text-muted-foreground'>
                {device.lastUsedAt
                  ? `last used ${new Date(device.lastUsedAt).toLocaleDateString()}`
                  : 'not used yet'}
              </span>
              {device.endpoint === data.endpoint && (
                <Badge variant='outline'>Current</Badge>
              )}
              <Button
                size='icon'
                variant='ghost'
                className='h-7 w-7'
                aria-label='Forget device'
                disabled={forget.isPending}
                onClick={() => void forget.mutateAsync(device.endpoint)}
              >
                <Trash2 className='h-3.5 w-3.5' />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
