import { useState } from 'react'
import { Copy, Loader2, Plus, RefreshCw, Send, Webhook } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
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
import { useProjects } from '@/features/projects/hooks/use-projects'
import {
  useDeleteWebhook,
  useRedeliverWebhook,
  useRotateWebhookSecret,
  useSaveWebhook,
  useTestWebhook,
  useWebhookDeliveries,
  useWebhookEventTypes,
  useWebhooks,
  type DeliveryStatus,
  type WebhookRecord,
} from '../hooks/use-integrations'

const NONE = '__none__'
const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : '—'

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Copied')
  } catch {
    toast.error('Copy failed — select the text and copy it by hand')
  }
}

const statusTone = (status: WebhookRecord['status']) =>
  status === 'active'
    ? 'border-green-500/50 text-green-700 dark:text-green-400'
    : status === 'disabled'
      ? 'border-red-500/50 text-red-700 dark:text-red-400'
      : ''

function WebhookDialog({
  webhook,
  open,
  onOpenChange,
  onSaved,
}: {
  webhook: WebhookRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (saved: WebhookRecord) => void
}) {
  const save = useSaveWebhook()
  const { data: projects } = useProjects()
  const { data: eventInfo } = useWebhookEventTypes()
  const [name, setName] = useState(webhook?.name ?? '')
  const [url, setUrl] = useState(webhook?.url ?? '')
  const [description, setDescription] = useState(webhook?.description ?? '')
  const [projectId, setProjectId] = useState(webhook?.projectId ?? '')
  const [eventsText, setEventsText] = useState(
    (webhook?.eventTypes ?? ['*']).join('\n')
  )
  const addEvent = (key: string) =>
    setEventsText((prev) => {
      const list = prev
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
      return list.includes(key) ? prev : [...list, key].join('\n')
    })

  const submit = async () => {
    const eventTypes = eventsText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
    if (!name.trim() || !url.trim() || eventTypes.length === 0) {
      toast.error('Name, URL and at least one event are needed')
      return
    }
    try {
      const saved = await save.mutateAsync({
        id: webhook?.id ?? null,
        payload: {
          name: name.trim(),
          url: url.trim(),
          description: description.trim() || null,
          projectId: projectId || null,
          eventTypes,
        },
      })
      onSaved(saved)
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{webhook ? 'Edit webhook' : 'New webhook'}</DialogTitle>
          <DialogDescription>
            Events are POSTed as JSON to your https endpoint, signed with the
            secret ({eventInfo?.signatureHeader ?? 'x-octapm-signature'}) and
            retried {eventInfo?.maxAttempts ?? 5} times.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label htmlFor='wh-name'>Name</Label>
              <Input
                id='wh-name'
                data-testid='uat-webhook-name'
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='wh-project'>Project</Label>
              <Select
                value={projectId || NONE}
                onValueChange={(value) =>
                  setProjectId(value === NONE ? '' : value)
                }
              >
                <SelectTrigger id='wh-project'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Every project</SelectItem>
                  {(projects?.items ?? []).map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='wh-url'>Endpoint URL</Label>
            <Input
              id='wh-url'
              data-testid='uat-webhook-url'
              placeholder='https://erp.example.com/octapm'
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='wh-description'>Description</Label>
            <Input
              id='wh-description'
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='wh-events'>Events (one per line)</Label>
            <Textarea
              id='wh-events'
              data-testid='uat-webhook-events'
              rows={4}
              value={eventsText}
              onChange={(event) => setEventsText(event.target.value)}
            />
            <div className='flex flex-wrap gap-1'>
              {(eventInfo?.eventTypes ?? [])
                .filter((item) => !item.key.includes('<'))
                .map((item) => (
                  <Button
                    key={item.key}
                    type='button'
                    size='sm'
                    variant='outline'
                    className='h-7 px-2 text-xs'
                    onClick={() => addEvent(item.key)}
                  >
                    {item.key}
                  </Button>
                ))}
              {['rfi.*', 'submittal.*', 'change_order.*', 'sub_pay_app.*'].map(
                (key) => (
                  <Button
                    key={key}
                    type='button'
                    size='sm'
                    variant='outline'
                    className='h-7 px-2 text-xs'
                    onClick={() => addEvent(key)}
                  >
                    {key}
                  </Button>
                )
              )}
            </div>
            <p className='text-xs text-muted-foreground'>
              Patterns: <code>*</code>, <code>record.changed</code>,{' '}
              <code>rfi.*</code> or <code>rfi.status_changed</code>.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            disabled={save.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type='button'
            disabled={save.isPending}
            data-testid='uat-webhook-save'
            onClick={submit}
          >
            {save.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            {webhook ? 'Save changes' : 'Create webhook'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SecretDialog({
  webhook,
  onClose,
}: {
  webhook: WebhookRecord | null
  onClose: () => void
}) {
  return (
    <Dialog open={Boolean(webhook)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Signing secret</DialogTitle>
          <DialogDescription>
            Shown once. Verify deliveries with HMAC-SHA256 over{' '}
            <code>{'<t>.<raw body>'}</code> from the signature header.
          </DialogDescription>
        </DialogHeader>
        <div className='flex items-center gap-2'>
          <Input
            readOnly
            value={webhook?.secret ?? ''}
            data-testid='uat-webhook-secret'
            className='font-mono text-xs'
          />
          <Button
            type='button'
            variant='outline'
            size='icon'
            aria-label='Copy secret'
            onClick={() => webhook?.secret && copy(webhook.secret)}
          >
            <Copy className='h-4 w-4' />
          </Button>
        </div>
        <DialogFooter>
          <Button type='button' onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeliveriesDialog({
  webhook,
  onClose,
}: {
  webhook: WebhookRecord | null
  onClose: () => void
}) {
  const [status, setStatus] = useState<DeliveryStatus | 'all'>('all')
  const { data: deliveries = [], isLoading } = useWebhookDeliveries(
    webhook?.id ?? null,
    status
  )
  const redeliver = useRedeliverWebhook()
  return (
    <Dialog open={Boolean(webhook)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>Deliveries · {webhook?.name}</DialogTitle>
          <DialogDescription>
            Latest first. Failed deliveries retry with backoff; dead ones can be
            redelivered.
          </DialogDescription>
        </DialogHeader>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as DeliveryStatus | 'all')}
        >
          <SelectTrigger className='w-48' aria-label='Delivery status'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All</SelectItem>
            <SelectItem value='pending'>Pending</SelectItem>
            <SelectItem value='delivered'>Delivered</SelectItem>
            <SelectItem value='failed'>Failed (retrying)</SelectItem>
            <SelectItem value='dead'>Dead</SelectItem>
          </SelectContent>
        </Select>
        {isLoading ? (
          <p className='text-sm text-muted-foreground'>Loading…</p>
        ) : deliveries.length === 0 ? (
          <p className='text-sm text-muted-foreground'>No deliveries yet.</p>
        ) : (
          <ul className='divide-y rounded-md border text-sm'>
            {deliveries.map((delivery) => (
              <li
                key={delivery.id}
                className='flex flex-wrap items-center gap-2 px-3 py-2'
                data-testid={`uat-webhook-delivery-${delivery.status}`}
              >
                <code className='text-xs'>{delivery.eventType}</code>
                <Badge
                  variant={
                    delivery.status === 'delivered'
                      ? 'outline'
                      : delivery.status === 'dead'
                        ? 'destructive'
                        : 'secondary'
                  }
                >
                  {delivery.status}
                </Badge>
                <span className='text-xs text-muted-foreground'>
                  attempt {delivery.attempt}/{delivery.maxAttempts}
                  {delivery.responseStatus
                    ? ` · HTTP ${delivery.responseStatus}`
                    : ''}
                  {delivery.durationMs !== null
                    ? ` · ${delivery.durationMs} ms`
                    : ''}
                  {' · '}
                  {formatDate(delivery.deliveredAt ?? delivery.updatedAt)}
                </span>
                {delivery.error && (
                  <span className='w-full text-xs text-destructive'>
                    {delivery.error}
                  </span>
                )}
                {(delivery.status === 'dead' ||
                  delivery.status === 'failed') && (
                  <Button
                    size='sm'
                    variant='outline'
                    className='ml-auto h-7'
                    disabled={redeliver.isPending}
                    onClick={async () => {
                      try {
                        await redeliver.mutateAsync(delivery.id)
                        toast.success('Redelivery queued')
                      } catch (error) {
                        toast.error(getServerErrorMessage(error))
                      }
                    }}
                  >
                    Redeliver
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Company webhooks: subscriptions, secrets, tests and the delivery log. */
export function WebhooksPanel() {
  const { data: webhooks = [], isLoading } = useWebhooks()
  const save = useSaveWebhook()
  const remove = useDeleteWebhook()
  const rotate = useRotateWebhookSecret()
  const test = useTestWebhook()
  const [editor, setEditor] = useState<{
    open: boolean
    webhook: WebhookRecord | null
    nonce: number
  }>({ open: false, webhook: null, nonce: 0 })
  const [secretFor, setSecretFor] = useState<WebhookRecord | null>(null)
  const [deliveriesFor, setDeliveriesFor] = useState<WebhookRecord | null>(null)

  return (
    <div className='space-y-3' data-testid='uat-webhooks'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-sm text-muted-foreground'>
          Push record changes, approvals, notifications and job progress to
          other systems as they happen.
        </p>
        <Button
          size='sm'
          data-testid='uat-webhook-new'
          onClick={() =>
            setEditor((prev) => ({
              open: true,
              webhook: null,
              nonce: prev.nonce + 1,
            }))
          }
        >
          <Plus className='mr-1 h-4 w-4' />
          New webhook
        </Button>
      </div>
      {isLoading ? (
        <p className='text-sm text-muted-foreground'>Loading…</p>
      ) : webhooks.length === 0 ? (
        <p className='rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground'>
          No webhooks yet.
        </p>
      ) : (
        <ul className='divide-y rounded-md border'>
          {webhooks.map((webhook) => (
            <li
              key={webhook.id}
              className='space-y-1 px-3 py-2 text-sm'
              data-testid='uat-webhook-row'
            >
              <div className='flex flex-wrap items-center gap-2'>
                <Webhook className='h-4 w-4 text-muted-foreground' />
                <span className='font-medium'>{webhook.name}</span>
                <Badge
                  variant='outline'
                  className={cn(statusTone(webhook.status))}
                >
                  {webhook.status}
                </Badge>
                {webhook.project && (
                  <Badge variant='secondary'>{webhook.project.name}</Badge>
                )}
                <span className='truncate text-xs text-muted-foreground'>
                  {webhook.url}
                </span>
                <div className='ml-auto flex flex-wrap gap-1'>
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-7'
                    disabled={test.isPending}
                    data-testid='uat-webhook-test'
                    onClick={async () => {
                      try {
                        const result = await test.mutateAsync(webhook.id)
                        if (result.ok)
                          toast.success(
                            `Delivered (HTTP ${result.delivery.responseStatus ?? '?'})`
                          )
                        else toast.error(result.error ?? 'Delivery failed')
                      } catch (error) {
                        toast.error(getServerErrorMessage(error))
                      }
                    }}
                  >
                    <Send className='mr-1 h-3 w-3' />
                    Test
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-7'
                    onClick={() => setDeliveriesFor(webhook)}
                  >
                    Deliveries
                    {webhook.deliveryCount ? ` (${webhook.deliveryCount})` : ''}
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-7'
                    onClick={() =>
                      setEditor((prev) => ({
                        open: true,
                        webhook,
                        nonce: prev.nonce + 1,
                      }))
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-7'
                    disabled={save.isPending}
                    onClick={async () => {
                      try {
                        await save.mutateAsync({
                          id: webhook.id,
                          payload: {
                            status:
                              webhook.status === 'active' ? 'paused' : 'active',
                          },
                        })
                      } catch (error) {
                        toast.error(getServerErrorMessage(error))
                      }
                    }}
                  >
                    {webhook.status === 'active' ? 'Pause' : 'Enable'}
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='h-7'
                    disabled={rotate.isPending}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          'Rotate the signing secret? The receiver must be updated.'
                        )
                      )
                        return
                      try {
                        setSecretFor(await rotate.mutateAsync(webhook.id))
                      } catch (error) {
                        toast.error(getServerErrorMessage(error))
                      }
                    }}
                  >
                    <RefreshCw className='mr-1 h-3 w-3' />
                    Secret
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='h-7'
                    disabled={remove.isPending}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Delete "${webhook.name}" and its delivery log?`
                        )
                      )
                        return
                      try {
                        await remove.mutateAsync(webhook.id)
                        toast.success('Webhook deleted')
                      } catch (error) {
                        toast.error(getServerErrorMessage(error))
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              <p className='text-xs text-muted-foreground'>
                {webhook.eventTypes.join(', ')} · last{' '}
                {webhook.lastStatus ?? 'never'}{' '}
                {webhook.lastDeliveryAt
                  ? formatDate(webhook.lastDeliveryAt)
                  : ''}
                {webhook.failureCount
                  ? ` · ${webhook.failureCount} dead in a row`
                  : ''}
                {webhook.lastError ? ` · ${webhook.lastError}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
      {editor.open && (
        <WebhookDialog
          key={`${editor.webhook?.id ?? 'new'}-${editor.nonce}`}
          webhook={editor.webhook}
          open={editor.open}
          onOpenChange={(open) => setEditor((prev) => ({ ...prev, open }))}
          onSaved={(saved) => {
            toast.success(
              editor.webhook ? 'Webhook updated' : 'Webhook created'
            )
            if (saved.secret) setSecretFor(saved)
          }}
        />
      )}
      <SecretDialog webhook={secretFor} onClose={() => setSecretFor(null)} />
      <DeliveriesDialog
        webhook={deliveriesFor}
        onClose={() => setDeliveriesFor(null)}
      />
    </div>
  )
}
