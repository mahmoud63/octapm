import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArrowLeft,
  Bell,
  BellOff,
  Link2,
  Loader2,
  LogOut,
  Mail,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  fetchOlderMessages,
  initials,
  useAddConversationMembers,
  useConversation,
  useConversationMessages,
  useDeleteMessage,
  useEditMessage,
  useMarkConversationRead,
  useRemoveConversationMember,
  useSendMessage,
  useSetConversationFlags,
  useUpdateConversation,
  type ConversationMessage,
} from '../hooks/use-conversations'
import { MessageComposer } from './message-composer'
import { PeoplePicker } from './people-picker'

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const dayKey = (iso: string | null) => (iso ? new Date(iso).toDateString() : '')
const dayLabel = (iso: string | null) => {
  if (!iso) return ''
  const date = new Date(iso)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}
const timeLabel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

function Body({ message }: { message: ConversationMessage }) {
  const names = message.mentions
    .map((mention) => mention.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => b.length - a.length)
  if (!names.length) {
    return (
      <p className='text-sm break-words whitespace-pre-wrap'>{message.body}</p>
    )
  }
  const pattern = new RegExp(`(@(?:${names.map(escapeRegExp).join('|')}))`, 'g')
  return (
    <p className='text-sm break-words whitespace-pre-wrap'>
      {message.body.split(pattern).map((part, index) =>
        index % 2 === 1 ? (
          <span
            key={`${part}-${index}`}
            className='rounded bg-primary/10 px-1 font-medium text-primary'
          >
            {part}
          </span>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        )
      )}
    </p>
  )
}

/** One conversation: header actions, the messages and the composer. */
export function ConversationThread({
  conversationId,
  onBack,
}: {
  conversationId: string
  onBack?: () => void
}) {
  const currentUser = useAuthStore((state) => state.auth.user)
  const { data: conversation, isLoading } = useConversation(conversationId)
  const { data: page } = useConversationMessages(conversationId)
  const send = useSendMessage()
  const edit = useEditMessage()
  const remove = useDeleteMessage()
  const flags = useSetConversationFlags()
  const update = useUpdateConversation()
  const addMembers = useAddConversationMembers()
  const removeMember = useRemoveConversationMember()
  const markRead = useMarkConversationRead()
  const [older, setOlder] = useState<{
    items: ConversationMessage[]
    nextCursor: string | null
  } | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(
    null
  )
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const lastCountRef = useRef(0)

  useEffect(() => {
    setOlder(null)
    lastCountRef.current = 0
  }, [conversationId])

  const messages = useMemo(
    () => [...(older?.items ?? []), ...(page?.items ?? [])],
    [older, page]
  )
  const nextCursor = older ? older.nextCursor : (page?.nextCursor ?? null)

  useEffect(() => {
    if (!page) return
    if (page.items.length !== lastCountRef.current) {
      lastCountRef.current = page.items.length
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
    if ((conversation?.unread ?? 0) > 0) markRead.mutate(conversationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, conversation?.unread, conversationId])

  const loadOlder = async () => {
    if (!nextCursor) return
    setLoadingOlder(true)
    try {
      const result = await fetchOlderMessages(conversationId, nextCursor)
      setOlder((current) => ({
        items: [...result.items, ...(current?.items ?? [])],
        nextCursor: result.nextCursor,
      }))
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    } finally {
      setLoadingOlder(false)
    }
  }

  const run = async (action: () => Promise<unknown>, done?: string) => {
    try {
      await action()
      if (done) toast.success(done)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  if (isLoading || !conversation) {
    return (
      <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' /> Opening…
      </div>
    )
  }

  const me = conversation.me
  const archived = Boolean(conversation.archivedAt)
  const canRename = conversation.kind !== 'direct'
  const groups: Array<{
    day: string
    label: string
    items: ConversationMessage[]
  }> = []
  for (const message of messages) {
    const key = dayKey(message.createdAt)
    const last = groups[groups.length - 1]
    if (last && last.day === key) last.items.push(message)
    else
      groups.push({
        day: key,
        label: dayLabel(message.createdAt),
        items: [message],
      })
  }

  return (
    <div
      className='flex h-full min-h-0 flex-col'
      data-testid='uat-conversation-thread'
    >
      <div className='flex items-start gap-2 border-b pb-2'>
        {onBack && (
          <Button
            variant='ghost'
            size='icon'
            className='md:hidden'
            onClick={onBack}
          >
            <ArrowLeft className='h-4 w-4' />
          </Button>
        )}
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <p className='truncate font-medium'>{conversation.title}</p>
            <Badge variant='outline' className='text-[10px] capitalize'>
              {conversation.kind}
            </Badge>
            {conversation.project && (
              <Badge variant='outline' className='text-[10px]'>
                {conversation.project.name}
              </Badge>
            )}
            {archived && (
              <Badge variant='outline' className='text-[10px]'>
                archived
              </Badge>
            )}
            {me?.muted && (
              <BellOff className='h-3.5 w-3.5 text-muted-foreground' />
            )}
          </div>
          <p className='truncate text-xs text-muted-foreground'>
            {conversation.members.map((member) => member.name).join(', ')}
          </p>
          {conversation.recordPath && (
            <a
              href={conversation.recordPath}
              className='mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline'
            >
              <Link2 className='h-3 w-3' /> Open {conversation.recordTitle}
            </a>
          )}
        </div>
        <Button
          variant='ghost'
          size='icon'
          title={me?.starred ? 'Unstar' : 'Star'}
          onClick={() =>
            run(() =>
              flags.mutateAsync({ id: conversationId, starred: !me?.starred })
            )
          }
          data-testid='uat-conversation-star'
        >
          <Star
            className={cn(
              'h-4 w-4',
              me?.starred && 'fill-amber-400 text-amber-500'
            )}
          />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              data-testid='uat-conversation-menu'
            >
              <MoreHorizontal className='h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-52'>
            <DropdownMenuItem
              onClick={() =>
                run(
                  () =>
                    flags.mutateAsync({
                      id: conversationId,
                      muted: !me?.muted,
                    }),
                  me?.muted ? 'Notifications on' : 'Muted'
                )
              }
            >
              {me?.muted ? (
                <Bell className='h-4 w-4' />
              ) : (
                <BellOff className='h-4 w-4' />
              )}
              {me?.muted ? 'Unmute' : 'Mute'}
            </DropdownMenuItem>
            {conversation.kind !== 'direct' && !archived && (
              <DropdownMenuItem onClick={() => setAdding(true)}>
                <UserPlus className='h-4 w-4' /> Add people
              </DropdownMenuItem>
            )}
            {canRename && !archived && (
              <DropdownMenuItem
                onClick={() =>
                  setRenaming(conversation.rawTitle ?? conversation.title)
                }
              >
                <Pencil className='h-4 w-4' /> Rename
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() =>
                run(
                  () =>
                    update.mutateAsync({
                      id: conversationId,
                      archived: !archived,
                    }),
                  archived ? 'Unarchived' : 'Archived'
                )
              }
            >
              <Archive className='h-4 w-4' />{' '}
              {archived ? 'Unarchive' : 'Archive'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className='text-destructive'
              onClick={() =>
                run(async () => {
                  await removeMember.mutateAsync({
                    id: conversationId,
                    userId: currentUser?.id ?? '',
                  })
                  onBack?.()
                }, 'You left the conversation')
              }
              data-testid='uat-conversation-leave'
            >
              <LogOut className='h-4 w-4' /> Leave
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        className='min-h-0 flex-1 overflow-y-auto py-3'
        data-testid='uat-conversation-messages'
      >
        {nextCursor && (
          <div className='mb-3 text-center'>
            <Button
              variant='outline'
              size='sm'
              disabled={loadingOlder}
              onClick={loadOlder}
            >
              {loadingOlder && (
                <Loader2 className='mr-1 h-4 w-4 animate-spin' />
              )}
              Load older messages
            </Button>
          </div>
        )}
        {messages.length === 0 && (
          <p className='py-8 text-center text-sm text-muted-foreground'>
            No messages yet — say hello.
          </p>
        )}
        {groups.map((group) => (
          <div key={group.day} className='space-y-2'>
            <div className='my-2 flex items-center gap-2 text-[11px] text-muted-foreground'>
              <span className='h-px flex-1 bg-border' />
              {group.label}
              <span className='h-px flex-1 bg-border' />
            </div>
            {group.items.map((message) =>
              message.kind === 'system' ? (
                <p
                  key={message.id}
                  className='text-center text-xs text-muted-foreground'
                >
                  {message.body}
                </p>
              ) : (
                <div
                  key={message.id}
                  className={cn(
                    'group flex gap-2',
                    message.isMine && 'flex-row-reverse'
                  )}
                >
                  <span className='mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold'>
                    {initials(message.author?.name)}
                  </span>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-lg border px-3 py-2',
                      message.isMine ? 'bg-primary/5' : 'bg-card'
                    )}
                  >
                    <div className='flex items-center gap-2 text-[11px] text-muted-foreground'>
                      <span className='font-medium text-foreground'>
                        {message.author?.name ?? 'Someone'}
                      </span>
                      <span>{timeLabel(message.createdAt)}</span>
                      {message.kind === 'email' && (
                        <span className='inline-flex items-center gap-0.5'>
                          <Mail className='h-3 w-3' /> via email
                        </span>
                      )}
                      {message.editedAt && <span>(edited)</span>}
                      {message.isMine && !message.deletedAt && !archived && (
                        <span className='ml-auto hidden gap-1 group-hover:flex'>
                          <button
                            type='button'
                            className='rounded p-0.5 hover:bg-muted'
                            onClick={() =>
                              setEditing({ id: message.id, body: message.body })
                            }
                            aria-label='Edit'
                          >
                            <Pencil className='h-3 w-3' />
                          </button>
                          <button
                            type='button'
                            className='rounded p-0.5 hover:bg-muted'
                            onClick={() => setConfirmDelete(message.id)}
                            aria-label='Remove'
                          >
                            <Trash2 className='h-3 w-3' />
                          </button>
                        </span>
                      )}
                    </div>
                    {message.deletedAt ? (
                      <p className='text-xs text-muted-foreground italic'>
                        Message removed
                      </p>
                    ) : editing?.id === message.id ? (
                      <div className='mt-1 space-y-1'>
                        <Textarea
                          rows={2}
                          value={editing.body}
                          onChange={(event) =>
                            setEditing({
                              id: message.id,
                              body: event.target.value,
                            })
                          }
                        />
                        <div className='flex gap-1'>
                          <Button
                            size='sm'
                            disabled={edit.isPending || !editing.body.trim()}
                            onClick={() =>
                              run(async () => {
                                await edit.mutateAsync({
                                  id: conversationId,
                                  messageId: message.id,
                                  body: editing.body.trim(),
                                })
                                setEditing(null)
                              })
                            }
                          >
                            Save
                          </Button>
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {message.body && <Body message={message} />}
                        {message.linkedRecord && (
                          <a
                            href={message.linkedRecord.path ?? '#'}
                            className='mt-1 flex w-full items-center gap-2 rounded border bg-muted/30 px-2 py-1 text-left text-xs hover:bg-muted/60'
                            data-testid='uat-message-linked-record'
                          >
                            <Link2 className='h-3.5 w-3.5 shrink-0' />
                            <span className='truncate'>
                              {message.linkedRecord.title ??
                                message.linkedRecord.recordType}
                            </span>
                          </a>
                        )}
                      </>
                    )}
                    {confirmDelete === message.id && (
                      <div className='mt-1 flex items-center gap-1 text-xs'>
                        <span>Remove this message?</span>
                        <Button
                          size='sm'
                          variant='destructive'
                          className='h-6 px-2'
                          disabled={remove.isPending}
                          onClick={() =>
                            run(async () => {
                              await remove.mutateAsync({
                                id: conversationId,
                                messageId: message.id,
                              })
                              setConfirmDelete(null)
                            })
                          }
                        >
                          Remove
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          className='h-6 px-2'
                          onClick={() => setConfirmDelete(null)}
                        >
                          Keep
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className='border-t pt-2'>
        {archived ? (
          <p className='text-xs text-muted-foreground'>
            This conversation is archived. Unarchive it to write.
          </p>
        ) : (
          <MessageComposer
            conversation={conversation}
            pending={send.isPending}
            onSend={(payload) =>
              run(() =>
                send.mutateAsync({
                  id: conversationId,
                  body: payload.body,
                  mentionUserIds: payload.mentionUserIds,
                  linkedRecord: payload.linkedRecord,
                })
              )
            }
          />
        )}
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Add people</DialogTitle>
            <DialogDescription>
              {conversation.projectId
                ? 'People who can open the project.'
                : 'Anyone in the organisation.'}
            </DialogDescription>
          </DialogHeader>
          <PeoplePicker
            projectId={conversation.projectId}
            exclude={conversation.members.map((member) => member.userId)}
            onConfirm={(userIds) =>
              run(async () => {
                await addMembers.mutateAsync({ id: conversationId, userIds })
                setAdding(false)
              }, 'People added')
            }
            confirmLabel='Add'
            pending={addMembers.isPending}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
      >
        <DialogContent className='sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <Input
            value={renaming ?? ''}
            maxLength={200}
            onChange={(event) => setRenaming(event.target.value)}
          />
          <DialogFooter>
            <Button variant='outline' onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              disabled={update.isPending}
              onClick={() =>
                run(async () => {
                  await update.mutateAsync({
                    id: conversationId,
                    title: (renaming ?? '').trim() || null,
                  })
                  setRenaming(null)
                }, 'Renamed')
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
