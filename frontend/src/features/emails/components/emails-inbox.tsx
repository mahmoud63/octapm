import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Copy,
  FileText,
  Inbox,
  Link2,
  Loader2,
  Mail,
  MessagesSquare,
  Paperclip,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Switch } from '@/components/ui/switch'
import { PeoplePicker } from '@/features/messages/components/people-picker'
import { RecordPickerDialog } from '@/features/messages/components/record-picker-dialog'
import type { ProjectSetupTarget } from '@/features/projects/data/schema'
import {
  EMAIL_STATUS_LABEL,
  useDeleteEmail,
  useEmailAction,
  useEmailSettings,
  useProjectEmail,
  useProjectEmails,
  useRotateEmailAddress,
  useUpdateEmailSettings,
  type InboundEmail,
  type InboundEmailStatus,
} from '../hooks/use-project-emails'

const ALL = '__all__'
const STATUS_CLASS: Record<InboundEmailStatus, string> = {
  received:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  posted:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  logged: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  linked:
    'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  ignored: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  unmatched:
    'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  rejected: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
}
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')
const size = (bytes: number | null) =>
  bytes === null
    ? ''
    : bytes > 1_000_000
      ? `${(bytes / 1_000_000).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1000))} KB`

function SettingsCard({ projectId }: { projectId: string }) {
  const canSettings = useCanPerform('email', 'update', 'email.settings')
  const { data: settings } = useEmailSettings(projectId)
  const update = useUpdateEmailSettings(projectId)
  const rotate = useRotateEmailAddress(projectId)
  const copy = async () => {
    if (!settings?.address) return
    try {
      await navigator.clipboard.writeText(settings.address)
      toast.success('Address copied')
    } catch {
      toast.error('Could not copy — select the address instead')
    }
  }
  return (
    <div className='rounded-md border p-3' data-testid='uat-emails-settings'>
      <div className='flex flex-wrap items-center gap-2'>
        <Mail className='h-4 w-4' />
        <p className='text-sm font-medium'>Project address</p>
        {settings && !settings.configured && (
          <Badge variant='outline' className='text-[10px]'>
            not configured on the server
          </Badge>
        )}
      </div>
      {settings?.configured ? (
        <>
          <div className='mt-2 flex flex-wrap items-center gap-2'>
            {settings.address ? (
              <code
                className='rounded bg-muted px-2 py-1 text-xs'
                data-testid='uat-emails-address'
              >
                {settings.address}
              </code>
            ) : (
              <span className='text-xs text-muted-foreground'>
                No address yet — issue one.
              </span>
            )}
            {settings.address && (
              <Button variant='outline' size='sm' onClick={copy}>
                <Copy className='mr-1 h-3.5 w-3.5' /> Copy
              </Button>
            )}
            {canSettings && (
              <Button
                variant='outline'
                size='sm'
                disabled={rotate.isPending}
                onClick={() =>
                  rotate
                    .mutateAsync()
                    .then(() =>
                      toast.success(
                        settings.address
                          ? 'New address issued — the old one stops working'
                          : 'Address issued'
                      )
                    )
                    .catch((error) => toast.error(getServerErrorMessage(error)))
                }
                data-testid='uat-emails-rotate'
              >
                <RefreshCw className='mr-1 h-3.5 w-3.5' />
                {settings.address ? 'New address' : 'Issue address'}
              </Button>
            )}
          </div>
          <p className='mt-1 text-xs text-muted-foreground'>
            Anyone can write to it — messages land in this inbox. Replies to
            notification emails go straight onto the record or conversation they
            came from.
          </p>
          <div className='mt-2 flex items-center justify-between rounded border px-3 py-2'>
            <div>
              <p className='text-sm'>
                Log incoming mail as correspondence automatically
              </p>
              <p className='text-xs text-muted-foreground'>
                Off: the team triages each email here first.
              </p>
            </div>
            <Switch
              checked={settings.autoLog}
              disabled={!canSettings || update.isPending}
              onCheckedChange={(value) =>
                update
                  .mutateAsync({ autoLog: value })
                  .catch((error) => toast.error(getServerErrorMessage(error)))
              }
              data-testid='uat-emails-autolog'
            />
          </div>
        </>
      ) : (
        <p className='mt-1 text-xs text-muted-foreground'>
          Set INBOUND_EMAIL_DOMAIN, INBOUND_EMAIL_SECRET and
          INBOUND_EMAIL_WEBHOOK_TOKEN on the server and point the mail
          provider's inbound webhook at{' '}
          {settings?.webhookPath ?? '/api/v1/public/inbound-email/{provider}'}.
        </p>
      )}
    </div>
  )
}

function EmailDialog({
  projectId,
  emailId,
  onOpenChange,
}: {
  projectId: string
  emailId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const canUpdate = useCanPerform('email', 'update')
  const canDelete = useCanPerform('email', 'delete')
  const { data: email, isLoading } = useProjectEmail(projectId, emailId)
  const action = useEmailAction(projectId)
  const remove = useDeleteEmail(projectId)
  const [mode, setMode] = useState<'none' | 'log' | 'conversation'>('none')
  const [logType, setLogType] = useState('email')
  const [notice, setNotice] = useState(false)
  const [pickRecord, setPickRecord] = useState(false)
  const [showFull, setShowFull] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    setMode('none')
    setLogType('email')
    setNotice(false)
    setShowFull(false)
    setConfirmDelete(false)
  }, [emailId])

  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn()
      toast.success(done)
      setMode('none')
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  const settled = email && ['posted', 'logged', 'linked'].includes(email.status)

  return (
    <Dialog open={Boolean(emailId)} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-2xl'
        data-testid='uat-email-dialog'
      >
        {isLoading || !email ? (
          <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Loading…
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className='pr-6'>{email.subject}</DialogTitle>
              <DialogDescription>
                From{' '}
                {email.from.name
                  ? `${email.from.name} <${email.from.email}>`
                  : email.from.email}{' '}
                · {fmt(email.receivedAt)}
                {email.target ? ` · ${email.target}` : ''}
              </DialogDescription>
            </DialogHeader>
            <div className='flex flex-wrap items-center gap-2'>
              <Badge variant='outline' className={STATUS_CLASS[email.status]}>
                {EMAIL_STATUS_LABEL[email.status]}
              </Badge>
              {email.error && (
                <span className='inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300'>
                  <AlertTriangle className='h-3.5 w-3.5' /> {email.error}
                </span>
              )}
              {email.recordPath && (
                <a
                  href={email.recordPath}
                  className='inline-flex items-center text-xs text-primary hover:underline'
                >
                  <Link2 className='mr-1 h-3 w-3' /> Open the record
                </a>
              )}
              {email.correspondencePath && (
                <a
                  href={email.correspondencePath}
                  className='inline-flex items-center text-xs text-primary hover:underline'
                >
                  <FileText className='mr-1 h-3 w-3' /> Open the correspondence
                </a>
              )}
              {email.conversationPath && (
                <a
                  href={email.conversationPath}
                  className='inline-flex items-center text-xs text-primary hover:underline'
                >
                  <MessagesSquare className='mr-1 h-3 w-3' /> Open the
                  conversation
                </a>
              )}
            </div>
            <div
              className='rounded-md border bg-muted/20 p-3 text-sm whitespace-pre-wrap'
              data-testid='uat-email-body'
            >
              {showFull || !email.replyText ? email.textBody : email.replyText}
              {email.replyText && email.replyText !== email.textBody && (
                <button
                  type='button'
                  className='mt-2 block text-xs text-primary hover:underline'
                  onClick={() => setShowFull((value) => !value)}
                >
                  {showFull ? 'Hide the quoted thread' : 'Show the full email'}
                </button>
              )}
            </div>
            {email.attachments.length > 0 && (
              <div className='flex flex-wrap gap-1.5'>
                {email.attachments.map((attachment, index) => (
                  <span
                    key={`${attachment.name}-${index}`}
                    className='inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs'
                    title={
                      attachment.stored
                        ? 'Saved as a project document'
                        : 'Not saved'
                    }
                  >
                    <Paperclip className='h-3 w-3' />
                    {attachment.name} {size(attachment.size)}
                    {!attachment.stored && (
                      <span className='text-muted-foreground'>(not saved)</span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {canUpdate && !settled && email.status !== 'ignored' && (
              <div
                className='flex flex-wrap gap-1.5'
                data-testid='uat-email-actions'
              >
                <Button
                  variant={mode === 'log' ? 'default' : 'outline'}
                  size='sm'
                  onClick={() => setMode(mode === 'log' ? 'none' : 'log')}
                  data-testid='uat-email-log'
                >
                  <FileText className='mr-1 h-4 w-4' /> Log as correspondence
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setPickRecord(true)}
                  data-testid='uat-email-post'
                >
                  <Link2 className='mr-1 h-4 w-4' /> Post to a record
                </Button>
                <Button
                  variant={mode === 'conversation' ? 'default' : 'outline'}
                  size='sm'
                  onClick={() =>
                    setMode(mode === 'conversation' ? 'none' : 'conversation')
                  }
                  data-testid='uat-email-conversation'
                >
                  <MessagesSquare className='mr-1 h-4 w-4' /> Start a
                  conversation
                </Button>
                <Button
                  variant='ghost'
                  size='sm'
                  disabled={action.isPending}
                  onClick={() =>
                    run(
                      () =>
                        action.mutateAsync({ id: email.id, action: 'ignore' }),
                      'Ignored'
                    )
                  }
                  data-testid='uat-email-ignore'
                >
                  <XCircle className='mr-1 h-4 w-4' /> Ignore
                </Button>
              </div>
            )}
            {mode === 'log' && (
              <div className='grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto_auto] sm:items-end'>
                <div className='space-y-1'>
                  <Label>Type</Label>
                  <Select value={logType} onValueChange={setLogType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['email', 'letter', 'memo', 'notice'].map((value) => (
                        <SelectItem
                          key={value}
                          value={value}
                          className='capitalize'
                        >
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <label className='flex items-center gap-2 text-sm'>
                  <Switch checked={notice} onCheckedChange={setNotice} />{' '}
                  Contractual notice
                </label>
                <Button
                  size='sm'
                  disabled={action.isPending}
                  onClick={() =>
                    run(
                      () =>
                        action.mutateAsync({
                          id: email.id,
                          action: 'log',
                          body: { type: logType, contractualNotice: notice },
                        }),
                      'Logged as correspondence'
                    )
                  }
                  data-testid='uat-email-log-confirm'
                >
                  {action.isPending && (
                    <Loader2 className='mr-1 h-4 w-4 animate-spin' />
                  )}{' '}
                  Log
                </Button>
              </div>
            )}
            {mode === 'conversation' && (
              <div className='rounded-md border p-3'>
                <p className='mb-2 text-xs text-muted-foreground'>
                  The sender joins when they are a user; the email becomes the
                  first message.
                </p>
                <PeoplePicker
                  projectId={projectId}
                  onConfirm={(userIds) =>
                    run(
                      () =>
                        action.mutateAsync({
                          id: email.id,
                          action: 'conversation',
                          body: { memberUserIds: userIds },
                        }),
                      'Conversation started'
                    )
                  }
                  confirmLabel='Start'
                  pending={action.isPending}
                />
              </div>
            )}
            {canDelete && (
              <div className='flex justify-end'>
                <Button
                  variant={confirmDelete ? 'destructive' : 'ghost'}
                  size='sm'
                  disabled={remove.isPending}
                  onClick={() =>
                    confirmDelete
                      ? run(async () => {
                          await remove.mutateAsync(email.id)
                          onOpenChange(false)
                        }, 'Email deleted')
                      : setConfirmDelete(true)
                  }
                  onBlur={() => setConfirmDelete(false)}
                  data-testid='uat-email-delete'
                >
                  <Trash2 className='mr-1 h-4 w-4' />{' '}
                  {confirmDelete ? 'Confirm delete' : 'Delete'}
                </Button>
              </div>
            )}
            <RecordPickerDialog
              open={pickRecord}
              onOpenChange={setPickRecord}
              projectId={projectId}
              title='Post the email on a record'
              description='The email becomes a comment on the record; attachments follow it.'
              onPick={(record) =>
                run(
                  () =>
                    action.mutateAsync({
                      id: email.id,
                      action: 'post',
                      body: {
                        recordType: record.recordType,
                        recordId: record.recordId,
                      },
                    }),
                  `Posted on ${record.title}`
                )
              }
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Doc control › Emails: the project inbox and its address. */
export function EmailsInbox({
  projectId,
  initialTarget,
}: {
  projectId: string
  initialTarget?: ProjectSetupTarget
}) {
  const [status, setStatus] = useState(ALL)
  const [q, setQ] = useState('')
  const { data, isLoading } = useProjectEmails(projectId, {
    status: status === ALL ? undefined : status,
    q,
  })
  const [openId, setOpenId] = useState<string | null>(
    initialTarget?.source === 'inbound_email'
      ? (initialTarget.recordId ?? null)
      : null
  )
  const summary = data?.summary

  return (
    <div className='space-y-3' data-testid='uat-emails'>
      <div className='flex flex-wrap items-center gap-2'>
        <Inbox className='h-5 w-5' />
        <div className='min-w-0 flex-1'>
          <p className='font-medium'>Project emails</p>
          <p className='text-xs text-muted-foreground'>
            Mail sent to the project address and replies to notifications — log
            it, post it on a record or turn it into a conversation.
          </p>
        </div>
      </div>
      <SettingsCard projectId={projectId} />
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
        {(
          [
            [
              'Needs action',
              summary?.needsAttention ?? '—',
              'received, unknown sender, failed',
            ],
            ['Posted', summary?.byStatus.posted ?? '—', 'replies on records'],
            ['Logged', summary?.byStatus.logged ?? '—', 'as correspondence'],
            [
              'Conversations',
              summary?.byStatus.linked ?? '—',
              'started from email',
            ],
          ] as const
        ).map(([label, value, hint]) => (
          <div key={label} className='rounded border p-3'>
            <p className='text-xs text-muted-foreground'>{label}</p>
            <p className='text-2xl font-bold tabular-nums'>{value}</p>
            <p className='text-[11px] text-muted-foreground'>{hint}</p>
          </div>
        ))}
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          className='w-64'
          placeholder='Search subject, sender, text'
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className='w-44'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(Object.keys(EMAIL_STATUS_LABEL) as InboundEmailStatus[]).map(
              (value) => (
                <SelectItem key={value} value={value}>
                  {EMAIL_STATUS_LABEL[value]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' /> Loading…
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <p className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
          No email yet. Share the project address, or reply to a notification
          email.
        </p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/50 text-xs text-muted-foreground'>
              <tr>
                <th className='px-2 py-1 text-left'>From</th>
                <th className='px-2 py-1 text-left'>Subject</th>
                <th className='px-2 py-1 text-left'>Received</th>
                <th className='px-2 py-1 text-left'>Went to</th>
                <th className='px-2 py-1 text-left'>Status</th>
              </tr>
            </thead>
            <tbody data-testid='uat-emails-rows'>
              {data!.items.map((email: InboundEmail) => (
                <tr
                  key={email.id}
                  className={cn(
                    'cursor-pointer border-t hover:bg-muted/40',
                    ['received', 'unmatched', 'rejected'].includes(
                      email.status
                    ) && 'font-medium'
                  )}
                  onClick={() => setOpenId(email.id)}
                >
                  <td className='max-w-48 truncate px-2 py-1'>
                    {email.from.name ?? email.from.email}
                  </td>
                  <td className='max-w-96 px-2 py-1'>
                    <span className='block truncate'>{email.subject}</span>
                    <span className='block truncate text-xs font-normal text-muted-foreground'>
                      {email.attachmentCount > 0 && (
                        <Paperclip className='mr-0.5 inline h-3 w-3' />
                      )}
                      {email.preview}
                    </span>
                  </td>
                  <td className='px-2 py-1 font-mono text-xs whitespace-nowrap'>
                    {fmt(email.receivedAt)}
                  </td>
                  <td className='px-2 py-1 text-xs capitalize'>
                    {email.target ?? '—'}
                  </td>
                  <td className='px-2 py-1'>
                    <Badge
                      variant='outline'
                      className={STATUS_CLASS[email.status]}
                    >
                      {EMAIL_STATUS_LABEL[email.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <EmailDialog
        projectId={projectId}
        emailId={openId}
        onOpenChange={(value) => !value && setOpenId(null)}
      />
    </div>
  )
}
