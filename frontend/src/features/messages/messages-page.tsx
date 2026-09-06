import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { BellOff, Loader2, MessagesSquare, Plus, Star } from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { realtime } from '@/lib/realtime'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Main } from '@/components/layout/main'
import { useProjects } from '@/features/projects/hooks/use-projects'
import { ConversationThread } from './components/conversation-thread'
import { NewConversationDialog } from './components/new-conversation-dialog'
import {
  conversationKeys,
  relativeTime,
  useConversations,
  type Conversation,
  type ConversationFilter,
} from './hooks/use-conversations'

const ALL = '__all__'
const FILTERS: Array<{ value: ConversationFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'starred', label: 'Starred' },
  { value: 'archived', label: 'Archived' },
]

function ConversationRow({
  conversation,
  active,
  onClick,
}: {
  conversation: Conversation
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      className={cn(
        'flex w-full items-start gap-2 border-b px-3 py-2 text-left hover:bg-muted/40',
        active && 'bg-primary/5'
      )}
      onClick={onClick}
      data-testid='uat-conversation-row'
    >
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1.5'>
          <span
            className={cn(
              'truncate text-sm',
              conversation.unread > 0 ? 'font-semibold' : 'font-medium'
            )}
          >
            {conversation.title}
          </span>
          {conversation.me?.starred && (
            <Star className='h-3 w-3 shrink-0 fill-amber-400 text-amber-500' />
          )}
          {conversation.me?.muted && (
            <BellOff className='h-3 w-3 shrink-0 text-muted-foreground' />
          )}
          <span className='ml-auto shrink-0 text-[11px] text-muted-foreground'>
            {relativeTime(conversation.lastMessageAt)}
          </span>
        </div>
        <p className='truncate text-xs text-muted-foreground'>
          {conversation.project ? `${conversation.project.name} · ` : ''}
          {conversation.lastMessagePreview ?? 'No messages yet'}
        </p>
      </div>
      {conversation.unread > 0 && (
        <Badge className='h-5 min-w-5 justify-center px-1.5 text-[10px]'>
          {conversation.unread}
        </Badge>
      )}
    </button>
  )
}

/** Messages (OCTA-COMM-CONV-042): conversations on the left, the open thread on the right. `?conversationId=` opens one. */
export function MessagesPage({
  conversationId,
}: {
  conversationId: string | null
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const canCreate = useCanPerform('conversation', 'create')
  const [filter, setFilter] = useState<ConversationFilter>('all')
  const [q, setQ] = useState('')
  const [projectId, setProjectId] = useState<string>(ALL)
  const [creating, setCreating] = useState(false)
  const { data: projectsData } = useProjects()
  const { data, isLoading } = useConversations({
    filter,
    q,
    projectId: projectId === ALL ? null : projectId,
  })

  // Members' own socket rooms receive every conversation event: refresh the lists and the open thread.
  useEffect(() => {
    const unsubscribe = realtime.subscribe((event) => {
      if (event.entityType !== 'conversation') return
      queryClient.invalidateQueries({ queryKey: conversationKeys.all })
    })
    return () => {
      unsubscribe()
    }
  }, [queryClient])

  const open = (id: string | null) =>
    navigate({ to: '/messages', search: id ? { conversationId: id } : {} })

  return (
    <Main className='flex flex-1 flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <MessagesSquare className='h-5 w-5' />
          <div>
            <h1 className='text-xl font-semibold'>Messages</h1>
            <p className='text-xs text-muted-foreground'>
              Direct and group conversations with your organisation and your
              projects' teams. Replies to email notifications land here too.
            </p>
          </div>
        </div>
        {canCreate && (
          <Button
            size='sm'
            onClick={() => setCreating(true)}
            data-testid='uat-messages-new'
          >
            <Plus className='mr-1 h-4 w-4' /> New conversation
          </Button>
        )}
      </div>

      <div
        className='grid min-h-0 flex-1 gap-3 md:grid-cols-[320px_minmax(0,1fr)]'
        style={{ height: 'calc(100vh - 11rem)' }}
      >
        <div
          className={cn(
            'flex min-h-0 flex-col rounded-md border',
            conversationId && 'hidden md:flex'
          )}
          data-testid='uat-messages-list'
        >
          <div className='space-y-2 border-b p-2'>
            <Input
              placeholder='Search conversations'
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
            <div className='flex flex-wrap items-center gap-1'>
              {FILTERS.map((item) => (
                <button
                  key={item.value}
                  type='button'
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-xs',
                    filter === item.value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  )}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label}
                  {item.value === 'unread' && data?.summary.unreadConversations
                    ? ` · ${data.summary.unreadConversations}`
                    : ''}
                </button>
              ))}
            </div>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className='h-8'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>
                  All projects and organisation
                </SelectItem>
                {(projectsData?.items ?? []).map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            {isLoading ? (
              <div className='flex items-center gap-2 p-3 text-sm text-muted-foreground'>
                <Loader2 className='h-4 w-4 animate-spin' /> Loading…
              </div>
            ) : (data?.items.length ?? 0) === 0 ? (
              <p className='p-3 text-sm text-muted-foreground'>
                {filter === 'all'
                  ? 'No conversations yet. Start one.'
                  : 'Nothing here.'}
              </p>
            ) : (
              data!.items.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === conversationId}
                  onClick={() => open(conversation.id)}
                />
              ))
            )}
          </div>
        </div>
        <div
          className={cn(
            'min-h-0 rounded-md border p-3',
            !conversationId && 'hidden md:block'
          )}
        >
          {conversationId ? (
            <ConversationThread
              conversationId={conversationId}
              onBack={() => open(null)}
            />
          ) : (
            <div className='flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground'>
              <MessagesSquare className='h-8 w-8 opacity-40' />
              <p>Pick a conversation, or start a new one.</p>
            </div>
          )}
        </div>
      </div>

      <NewConversationDialog
        open={creating}
        onOpenChange={setCreating}
        defaultProjectId={projectId === ALL ? null : projectId}
        onCreated={(id) => open(id)}
      />
    </Main>
  )
}
