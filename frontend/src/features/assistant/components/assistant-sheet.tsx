import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import {
  Loader2,
  Plus,
  SendHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { workspaceLink } from '@/features/workflows/hooks/use-workflow-engine'
import {
  askContextOf,
  useAiScreenContext,
} from '@/features/ai/hooks/use-ai-screen-context'
import { useAiDrawer } from '@/stores/ai-drawer-store'
import {
  splitCitations,
  useAskAssistant,
  useAssistantConversation,
  useAssistantConversations,
  useAssistantFeedback,
  useAssistantStatus,
  useDeleteAssistantConversation,
  useRunAssistantAction,
  type AssistantAction,
  type AssistantCitation,
  type AssistantMessage,
} from '../hooks/use-assistant'

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : ''

/** Reads the project id from the current URL so the assistant scopes itself. */
export const useCurrentProjectId = () => {
  const location = useLocation()
  // The project path lives under its workspace, `/o/{workspace}/projects/:id` (ENT-4).
  const match = /^(?:\/o\/[^/]+)?\/projects\/([^/]+)/.exec(location.pathname)
  return match?.[1] ?? null
}

export function CitationChip({ citation }: { citation: AssistantCitation }) {
  const link = workspaceLink(citation.url)
  const label = `${citation.n}`
  const title = `${citation.typeLabel}${citation.ref ? ` ${citation.ref}` : ''} — ${citation.title}`
  if (link) {
    return (
      <Link
        to='/projects/$projectId'
        params={{ projectId: link.projectId }}
        search={link.search}
        title={title}
        className='inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/15 px-1 align-super text-[10px] font-semibold text-primary hover:bg-primary/25'
        data-testid='uat-assistant-citation'
      >
        {label}
      </Link>
    )
  }
  return (
    <span
      title={title}
      className='inline-flex h-4 min-w-4 items-center justify-center rounded bg-muted px-1 align-super text-[10px] font-semibold'
    >
      {label}
    </span>
  )
}

/** Text with `[n]` markers rendered as citation chips; shared by every AI feature. */
export function CitedText({
  content,
  citations,
  className,
}: {
  content: string
  citations: AssistantCitation[]
  className?: string
}) {
  const byNumber = new Map(citations.map((citation) => [citation.n, citation]))
  return (
    <div className={cn('space-y-1 text-sm whitespace-pre-wrap', className)}>
      {content.split('\n').map((line, lineIndex) => (
        <p key={lineIndex} className={cn(line.startsWith('-') && 'pl-3')}>
          {splitCitations(line).map((part, index) => {
            if (part.kind === 'text')
              return <span key={index}>{part.text.replace(/\*\*/g, '')}</span>
            const citation = byNumber.get(part.n)
            return citation ? (
              <CitationChip key={index} citation={citation} />
            ) : (
              <span key={index}>[{part.n}]</span>
            )
          })}
        </p>
      ))}
    </div>
  )
}

function AnswerText({ message }: { message: AssistantMessage }) {
  return <CitedText content={message.content} citations={message.citations} />
}

export function SourcesList({ citations }: { citations: AssistantCitation[] }) {
  if (citations.length === 0) return null
  return (
    <ul className='space-y-0.5 text-xs' data-testid='uat-assistant-sources'>
      {citations.map((citation) => {
        const link = workspaceLink(citation.url)
        const label = `${citation.typeLabel}${citation.ref ? ` ${citation.ref}` : ''} · ${citation.title}${citation.projectName ? ` (${citation.projectName})` : ''}`
        return (
          <li key={citation.n} className='flex gap-1.5'>
            <span className='shrink-0 text-muted-foreground'>
              [{citation.n}]
            </span>
            {link ? (
              <Link
                to='/projects/$projectId'
                params={{ projectId: link.projectId }}
                search={link.search}
                className='truncate underline-offset-2 hover:underline'
              >
                {label}
              </Link>
            ) : (
              <span className='truncate'>{label}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function ActionButtons({
  projectId,
  message,
}: {
  projectId: string | null
  message: AssistantMessage
}) {
  const run = useRunAssistantAction(projectId ?? '')
  const navigate = useNavigate()
  if (message.actions.length === 0) return null
  return (
    <div className='flex flex-wrap gap-1.5' data-testid='uat-assistant-actions'>
      {message.actions.map((action, index) => {
        const link = workspaceLink(action.url)
        if (action.type === 'open') {
          return link ? (
            <Button
              key={index}
              asChild
              size='sm'
              variant='outline'
              className='h-7'
            >
              <Link
                to='/projects/$projectId'
                params={{ projectId: link.projectId }}
                search={link.search}
              >
                {action.label}
              </Link>
            </Button>
          ) : null
        }
        if (!projectId) return null
        return (
          <Button
            key={index}
            size='sm'
            variant='outline'
            className='h-7'
            disabled={run.isPending}
            data-testid={`uat-assistant-action-${action.type}`}
            onClick={async () => {
              try {
                const result = await run.mutateAsync(action as AssistantAction)
                toast.success(
                  `${result.record.ref ?? 'Record'} created as a draft`
                )
                const target = workspaceLink(result.url)
                if (target)
                  navigate({
                    to: '/projects/$projectId',
                    params: { projectId: target.projectId },
                    search: target.search,
                  })
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {run.isPending && <Loader2 className='mr-1 h-3 w-3 animate-spin' />}
            {action.label}
          </Button>
        )
      })}
    </div>
  )
}

function MessageBubble({
  projectId,
  message,
}: {
  projectId: string | null
  message: AssistantMessage
}) {
  const feedback = useAssistantFeedback(projectId)
  if (message.role === 'user') {
    return (
      <div
        className='ml-8 rounded-lg bg-primary/10 px-3 py-2 text-sm'
        data-testid='uat-assistant-question'
      >
        {message.content}
      </div>
    )
  }
  return (
    <div
      className='mr-4 space-y-2 rounded-lg border px-3 py-2'
      data-testid='uat-assistant-answer'
    >
      <AnswerText message={message} />
      <SourcesList citations={message.citations} />
      <ActionButtons projectId={projectId} message={message} />
      <div className='flex items-center gap-1 text-[10px] text-muted-foreground'>
        {message.model ? (
          <span>{message.model}</span>
        ) : (
          <span>search only</span>
        )}
        <span>· {formatDate(message.createdAt)}</span>
        <span className='ml-auto flex gap-0.5'>
          <button
            type='button'
            aria-label='Helpful'
            className={cn(
              'rounded p-0.5 hover:bg-muted',
              message.feedback === 'up' && 'text-green-600'
            )}
            onClick={() =>
              feedback.mutate({
                messageId: message.id,
                rating: message.feedback === 'up' ? null : 'up',
              })
            }
          >
            <ThumbsUp className='h-3 w-3' />
          </button>
          <button
            type='button'
            aria-label='Not helpful'
            className={cn(
              'rounded p-0.5 hover:bg-muted',
              message.feedback === 'down' && 'text-red-600'
            )}
            onClick={() =>
              feedback.mutate({
                messageId: message.id,
                rating: message.feedback === 'down' ? null : 'down',
              })
            }
          >
            <ThumbsDown className='h-3 w-3' />
          </button>
        </span>
      </div>
    </div>
  )
}

/** Slide-over: conversations on the left of the thread, question box at the bottom. */
export function AssistantSheet({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string | null
}) {
  const { data: status } = useAssistantStatus(projectId, open)
  const { data: conversations = [] } = useAssistantConversations(
    projectId,
    open
  )
  const [conversationId, setConversationId] = useState<string | null>(null)
  const { data: conversation } = useAssistantConversation(
    projectId,
    conversationId
  )
  const ask = useAskAssistant(projectId)
  const remove = useDeleteAssistantConversation(projectId)
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const messages = conversation?.messages ?? []
  // The screen the drawer is over, and what an AI action asked it (AI UX correction).
  const screen = useAiScreenContext()
  const requestId = useAiDrawer((state) => state.requestId)
  const actionQuestion = useAiDrawer((state) => state.question)
  const clearQuestion = useAiDrawer((state) => state.clearQuestion)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, pending])

  const submit = async (asked?: string) => {
    const text = (asked ?? question).trim()
    if (!text) return
    setPending(text)
    setQuestion('')
    try {
      const result = await ask.mutateAsync({ question: text, conversationId: asked ? null : conversationId, context: askContextOf(screen) })
      setConversationId(result.conversationId)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
      setQuestion(text)
    } finally {
      setPending(null)
    }
  }

  // An AI action opened the drawer with a question: a new conversation, asked at once.
  // Asked once per opening, even when an effect runs twice (StrictMode).
  const handledRequest = useRef<number | null>(null)
  useEffect(() => {
    if (!open || !actionQuestion || handledRequest.current === requestId) return
    handledRequest.current = requestId
    setConversationId(null)
    clearQuestion()
    void submit(actionQuestion)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requestId, actionQuestion])

  const contextParts = [
    screen.moduleLabel,
    screen.childLabel,
    screen.record?.label ?? null,
  ].filter(Boolean)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side='right'
        className='flex w-full flex-col gap-3 sm:max-w-2xl'
        data-testid='uat-assistant'
      >
        <SheetHeader>
          <SheetTitle className='flex items-center gap-2'>
            <Sparkles className='h-4 w-4' /> Ask OctaPM
          </SheetTitle>
          <SheetDescription>
            {projectId
              ? "Answers come from this project's records and documents you can see, with sources."
              : 'Answers come from every project you can open, with sources.'}
            {status && !status.enabled
              ? ' No AI provider is configured, so answers list the matching records instead.'
              : ''}
          </SheetDescription>
          {contextParts.length > 0 && (
            <p
              className='flex flex-wrap items-center gap-1 text-xs text-muted-foreground'
              data-testid='uat-assistant-context'
            >
              <span>Context:</span>
              {contextParts.map((part) => (
                <span key={part} className='rounded border bg-muted/50 px-1.5 py-0.5 text-foreground'>
                  {part}
                </span>
              ))}
            </p>
          )}
        </SheetHeader>
        <div className='flex min-h-0 flex-1 gap-3'>
          <aside className='hidden w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r pr-2 sm:flex'>
            <Button
              size='sm'
              variant='outline'
              className='h-7 justify-start'
              onClick={() => setConversationId(null)}
              data-testid='uat-assistant-new'
            >
              <Plus className='mr-1 h-3 w-3' /> New question
            </Button>
            {conversations.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'group flex items-center gap-1 rounded px-1 text-xs',
                  item.id === conversationId && 'bg-muted'
                )}
              >
                <button
                  type='button'
                  className='min-w-0 flex-1 truncate py-1 text-left'
                  title={item.title}
                  onClick={() => setConversationId(item.id)}
                >
                  {item.title}
                </button>
                <button
                  type='button'
                  aria-label='Delete conversation'
                  className='hidden rounded p-0.5 text-muted-foreground group-hover:block hover:text-destructive'
                  onClick={async () => {
                    try {
                      await remove.mutateAsync(item.id)
                      if (item.id === conversationId) setConversationId(null)
                    } catch (error) {
                      toast.error(getServerErrorMessage(error))
                    }
                  }}
                >
                  <Trash2 className='h-3 w-3' />
                </button>
              </div>
            ))}
          </aside>
          <div className='flex min-h-0 flex-1 flex-col'>
            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto pr-1'>
              {messages.length === 0 && !pending && (
                <div className='space-y-2 py-6 text-sm text-muted-foreground'>
                  <p>Try questions like:</p>
                  <ul className='space-y-1'>
                    {[
                      'What is still open on the piling subcontract?',
                      'Which RFIs are waiting on the consultant this week?',
                      'What did the specification say about pile cap links?',
                      'Summarise the last site meeting actions',
                    ].map((sample) => (
                      <li key={sample}>
                        <button
                          type='button'
                          className='text-left underline-offset-2 hover:underline'
                          onClick={() => setQuestion(sample)}
                        >
                          {sample}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  projectId={projectId}
                  message={message}
                />
              ))}
              {pending && (
                <>
                  <div className='ml-8 rounded-lg bg-primary/10 px-3 py-2 text-sm'>
                    {pending}
                  </div>
                  <div className='mr-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-muted-foreground'>
                    <Loader2 className='h-4 w-4 animate-spin' /> Looking through
                    your records and documents…
                  </div>
                </>
              )}
              <div ref={bottomRef} />
            </div>
            <div className='mt-2 flex items-end gap-2'>
              <Textarea
                rows={2}
                placeholder='Ask about this project…'
                value={question}
                disabled={ask.isPending}
                data-testid='uat-assistant-question-input'
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void submit()
                  }
                }}
              />
              <Button
                size='icon'
                disabled={!question.trim() || ask.isPending}
                onClick={() => void submit()}
                aria-label='Ask'
                data-testid='uat-assistant-ask'
              >
                {ask.isPending ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <SendHorizontal className='h-4 w-4' />
                )}
              </Button>
            </div>
            {status?.enabled && (
              <p className='mt-1 text-[10px] text-muted-foreground'>
                <Badge variant='outline' className='mr-1 px-1 py-0 text-[10px]'>
                  {status.provider}
                </Badge>
                Answers cite their sources; check them before acting.
              </p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Top-bar button that opens the assistant scoped to the current project. */
/**
 * The global Ask OctaPM button in the header, and the one drawer every AI
 * action on every screen opens (stores/ai-drawer-store).
 */
export function AssistantButton() {
  const openDrawer = useAiDrawer((state) => state.openDrawer)
  return (
    <Button
      variant='ghost'
      size='sm'
      aria-label='Ask OctaPM'
      title='Ask OctaPM about this screen'
      className='gap-1.5 px-2'
      onClick={() => openDrawer()}
      data-testid='uat-assistant-open'
    >
      <Sparkles className='h-4 w-4' />
      <span className='hidden lg:inline'>Ask OctaPM</span>
    </Button>
  )
}

/**
 * The one Ask OctaPM drawer, mounted once in the authenticated shell
 * (AskOctaPMLauncher) whatever opened it: the header button, the floating
 * button or an AI action on a screen.
 */
export function AssistantDrawerHost() {
  const projectId = useCurrentProjectId()
  const open = useAiDrawer((state) => state.open)
  const setOpen = useAiDrawer((state) => state.setOpen)
  if (!open) return null
  return <AssistantSheet open={open} onOpenChange={setOpen} projectId={projectId} />
}
