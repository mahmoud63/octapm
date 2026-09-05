import { useState } from 'react'
import {
  Download,
  ExternalLink,
  Landmark,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  SYNC_STATUS_LABEL,
  downloadAccountingExport,
  useAccountingAccounts,
  useAccountingConnections,
  useAccountingMappings,
  useAccountingSyncs,
  useConnectAccounting,
  useDeleteAccountingMapping,
  useDisconnectAccounting,
  usePollAccounting,
  useRetryAccountingSync,
  useSaveAccountingMapping,
  useUpdateAccountingConnection,
  type AccountingProvider,
  type SyncStatus,
} from '../hooks/use-integrations'

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : '—'

const money = (value: number, currency: string | null) =>
  `${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`

function ConnectionCards() {
  const { data: connections = [], isLoading } = useAccountingConnections()
  const connect = useConnectAccounting()
  const disconnect = useDisconnectAccounting()
  const update = useUpdateAccountingConnection()
  if (isLoading)
    return <p className='text-sm text-muted-foreground'>Loading…</p>
  return (
    <div
      className='grid gap-3 md:grid-cols-2'
      data-testid='uat-accounting-connections'
    >
      {connections.map((connection) => (
        <div
          key={connection.provider}
          className='space-y-2 rounded-md border p-3'
          data-testid={`uat-accounting-${connection.provider}`}
        >
          <div className='flex flex-wrap items-center gap-2'>
            <Landmark className='h-4 w-4 text-muted-foreground' />
            <span className='font-medium'>{connection.label}</span>
            <Badge
              variant={
                connection.status === 'connected'
                  ? 'default'
                  : connection.status === 'error'
                    ? 'destructive'
                    : 'outline'
              }
            >
              {connection.status}
            </Badge>
            {connection.externalOrgName && (
              <span className='text-xs text-muted-foreground'>
                {connection.externalOrgName}
              </span>
            )}
          </div>
          {!connection.configured && (
            <p className='text-xs text-muted-foreground'>
              Set{' '}
              {connection.provider === 'qbo'
                ? 'QBO_CLIENT_ID / QBO_CLIENT_SECRET'
                : 'XERO_CLIENT_ID / XERO_CLIENT_SECRET'}{' '}
              on the server to enable this connector.
            </p>
          )}
          {!connection.encryptionReady && (
            <p className='text-xs text-muted-foreground'>
              Set INTEGRATION_SECRET_KEY on the server so tokens can be stored
              encrypted.
            </p>
          )}
          {connection.lastError && (
            <p className='text-xs text-destructive'>{connection.lastError}</p>
          )}
          {connection.status === 'connected' ? (
            <>
              <label className='flex items-center gap-2 text-sm'>
                <Switch
                  checked={connection.autoSyncPayApps}
                  disabled={update.isPending}
                  onCheckedChange={async (checked) => {
                    try {
                      await update.mutateAsync({
                        provider: connection.provider,
                        payload: { autoSyncPayApps: checked },
                      })
                    } catch (error) {
                      toast.error(getServerErrorMessage(error))
                    }
                  }}
                />
                Post approved pay applications automatically
              </label>
              <p className='text-xs text-muted-foreground'>
                Connected {formatDate(connection.connectedAt)} · last sync{' '}
                {formatDate(connection.lastSyncAt)}
              </p>
              <Button
                size='sm'
                variant='ghost'
                disabled={disconnect.isPending}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Disconnect ${connection.label}? Tokens are forgotten; posted bills stay.`
                    )
                  )
                    return
                  try {
                    await disconnect.mutateAsync(connection.provider)
                    toast.success('Disconnected')
                  } catch (error) {
                    toast.error(getServerErrorMessage(error))
                  }
                }}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              size='sm'
              disabled={
                !connection.configured ||
                !connection.encryptionReady ||
                connect.isPending
              }
              data-testid={`uat-accounting-connect-${connection.provider}`}
              onClick={async () => {
                try {
                  const result = await connect.mutateAsync(connection.provider)
                  window.open(result.url, '_blank', 'noopener')
                  toast.success(
                    `Sign in to ${connection.label} in the new tab, then come back here`
                  )
                } catch (error) {
                  toast.error(getServerErrorMessage(error))
                }
              }}
            >
              <ExternalLink className='mr-1 h-4 w-4' />
              Connect
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

function MappingsTable({ provider }: { provider: AccountingProvider }) {
  const { data: connections = [] } = useAccountingConnections()
  const connected =
    connections.find((item) => item.provider === provider)?.status ===
    'connected'
  const { data: accounts = [] } = useAccountingAccounts(provider, connected)
  const { data: mappings = [] } = useAccountingMappings(provider)
  const save = useSaveAccountingMapping()
  const remove = useDeleteAccountingMapping()
  const [costCode, setCostCode] = useState('')
  const [accountId, setAccountId] = useState('')
  const [accountName, setAccountName] = useState('')
  const accountLabel = (id: string | null) => {
    const account = accounts.find((item) => item.id === id)
    return account
      ? `${account.code ? `${account.code} ` : ''}${account.name}`
      : null
  }

  return (
    <div className='space-y-2' data-testid='uat-accounting-mappings'>
      <p className='text-xs text-muted-foreground'>
        Each cost code posts to an account; <code>*</code> is the default,{' '}
        <code>retention</code> and <code>back_charges</code> the reserved codes
        for withheld amounts.
      </p>
      <div className='grid gap-2 sm:grid-cols-[160px_1fr_auto]'>
        <Input
          placeholder='Cost code or *'
          aria-label='Cost code'
          data-testid='uat-accounting-mapping-code'
          value={costCode}
          onChange={(event) => setCostCode(event.target.value)}
        />
        {connected && accounts.length > 0 ? (
          <Select
            value={accountId}
            onValueChange={(value) => {
              setAccountId(value)
              setAccountName(accountLabel(value) ?? '')
            }}
          >
            <SelectTrigger aria-label='Account'>
              <SelectValue placeholder='Account in the accounting system' />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.code ? `${account.code} · ` : ''}
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            placeholder={
              provider === 'xero' ? 'Account code (e.g. 300)' : 'Account id'
            }
            aria-label='Account'
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          />
        )}
        <Button
          size='sm'
          disabled={save.isPending || !costCode.trim() || !accountId.trim()}
          data-testid='uat-accounting-mapping-save'
          onClick={async () => {
            try {
              await save.mutateAsync({
                provider,
                costCode: costCode.trim(),
                externalAccountId: accountId.trim(),
                externalAccountName:
                  accountName || accountLabel(accountId) || null,
              })
              setCostCode('')
              setAccountId('')
              setAccountName('')
              toast.success('Mapping saved')
            } catch (error) {
              toast.error(getServerErrorMessage(error))
            }
          }}
        >
          Map
        </Button>
      </div>
      {mappings.length > 0 && (
        <ul className='divide-y rounded-md border text-sm'>
          {mappings.map((mapping) => (
            <li
              key={mapping.id}
              className='flex items-center gap-2 px-3 py-1.5'
            >
              <code className='rounded bg-muted px-1 text-xs'>
                {mapping.costCode}
              </code>
              <span>→</span>
              <span>
                {mapping.externalAccountName ??
                  accountLabel(mapping.externalAccountId) ??
                  mapping.externalAccountId}
              </span>
              <Button
                size='sm'
                variant='ghost'
                className='ml-auto h-7'
                disabled={remove.isPending}
                onClick={async () => {
                  try {
                    await remove.mutateAsync(mapping.id)
                  } catch (error) {
                    toast.error(getServerErrorMessage(error))
                  }
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SyncLog() {
  const [status, setStatus] = useState<SyncStatus | 'all'>('all')
  const { data: syncs = [] } = useAccountingSyncs(status)
  const retry = useRetryAccountingSync()
  const poll = usePollAccounting()
  return (
    <div className='space-y-2' data-testid='uat-accounting-syncs'>
      <div className='flex flex-wrap items-center gap-2'>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as SyncStatus | 'all')}
        >
          <SelectTrigger className='w-44' aria-label='Sync status'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All</SelectItem>
            {(Object.keys(SYNC_STATUS_LABEL) as SyncStatus[]).map((key) => (
              <SelectItem key={key} value={key}>
                {SYNC_STATUS_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size='sm'
          variant='outline'
          disabled={poll.isPending}
          data-testid='uat-accounting-poll'
          onClick={async () => {
            try {
              const result = await poll.mutateAsync()
              toast.success(
                `${result.checked} bill${result.checked === 1 ? '' : 's'} checked, ${result.paid} paid`
              )
            } catch (error) {
              toast.error(getServerErrorMessage(error))
            }
          }}
        >
          <RefreshCw className='mr-1 h-4 w-4' />
          Check payments now
        </Button>
      </div>
      {syncs.length === 0 ? (
        <p className='text-sm text-muted-foreground'>Nothing posted yet.</p>
      ) : (
        <ul className='divide-y rounded-md border text-sm'>
          {syncs.map((sync) => (
            <li
              key={sync.id}
              className='flex flex-wrap items-center gap-2 px-3 py-1.5'
              data-testid={`uat-accounting-sync-${sync.status}`}
            >
              <span className='font-medium'>
                {sync.externalRef ?? sync.recordId.slice(0, 8)}
              </span>
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
              <span className='text-xs text-muted-foreground'>
                {sync.providerLabel} · {sync.project?.name ?? ''} ·{' '}
                {money(sync.amount, sync.currency)}
                {sync.syncedAt ? ` · posted ${formatDate(sync.syncedAt)}` : ''}
                {sync.paidAt ? ` · paid ${formatDate(sync.paidAt)}` : ''}
              </span>
              {sync.lastError && (
                <span className='w-full text-xs text-destructive'>
                  {sync.lastError}
                </span>
              )}
              {sync.status === 'failed' && (
                <Button
                  size='sm'
                  variant='outline'
                  className='ml-auto h-7'
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
    </div>
  )
}

/** Company accounting: connections, cost-code mappings, posted bills and the ERP export. */
export function AccountingPanel() {
  const [provider, setProvider] = useState<AccountingProvider>('qbo')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [exporting, setExporting] = useState<'xlsx' | 'csv' | null>(null)
  return (
    <div className='space-y-5' data-testid='uat-accounting'>
      <section className='space-y-2'>
        <h4 className='text-sm font-semibold'>Connections</h4>
        <ConnectionCards />
      </section>
      <section className='space-y-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <h4 className='text-sm font-semibold'>Cost code mapping</h4>
          <Select
            value={provider}
            onValueChange={(value) => setProvider(value as AccountingProvider)}
          >
            <SelectTrigger className='w-44' aria-label='Provider'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='qbo'>QuickBooks Online</SelectItem>
              <SelectItem value='xero'>Xero</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <MappingsTable provider={provider} />
      </section>
      <section className='space-y-2'>
        <h4 className='text-sm font-semibold'>Posted bills</h4>
        <SyncLog />
      </section>
      <section className='space-y-2'>
        <h4 className='text-sm font-semibold'>Export for any ERP</h4>
        <p className='text-xs text-muted-foreground'>
          Approved and paid pay applications as cost lines by cost code, with
          the selected provider's account mapping.
        </p>
        <div className='flex flex-wrap items-end gap-2'>
          <div className='space-y-1'>
            <Label htmlFor='exp-from' className='text-xs'>
              Approved from
            </Label>
            <Input
              id='exp-from'
              type='date'
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='exp-to' className='text-xs'>
              to
            </Label>
            <Input
              id='exp-to'
              type='date'
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          {(['xlsx', 'csv'] as const).map((format) => (
            <Button
              key={format}
              size='sm'
              variant='outline'
              disabled={exporting !== null}
              data-testid={`uat-accounting-export-${format}`}
              onClick={async () => {
                setExporting(format)
                try {
                  await downloadAccountingExport({
                    format,
                    provider,
                    from: from || null,
                    to: to || null,
                  })
                } catch (error) {
                  toast.error(getServerErrorMessage(error))
                } finally {
                  setExporting(null)
                }
              }}
            >
              {exporting === format ? (
                <Loader2 className='mr-1 h-4 w-4 animate-spin' />
              ) : (
                <Download className='mr-1 h-4 w-4' />
              )}
              {format.toUpperCase()}
            </Button>
          ))}
        </div>
      </section>
    </div>
  )
}
