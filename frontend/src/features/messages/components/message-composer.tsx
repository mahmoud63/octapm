import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import { AtSign, Link2, Loader2, Send, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  initials,
  type Conversation,
  type ConversationMember,
  type LinkedRecordInput,
} from '../hooks/use-conversations'
import { RecordPickerDialog, type PickedRecord } from './record-picker-dialog'

const MENTION_TOKEN = /(?:^|\s)@([^\s@]*)$/
const MAX_SUGGESTIONS = 6

export interface ComposerPayload {
  body: string
  mentionUserIds: string[]
  linkedRecord: LinkedRecordInput | null
}

/** Text with explicit @mentions of members and an optional shared record. */
export function MessageComposer({
  conversation,
  onSend,
  pending,
  disabled,
  placeholder = 'Write a message… @ to mention, Ctrl+Enter to send',
}: {
  conversation: Conversation
  onSend: (payload: ComposerPayload) => Promise<void>
  pending?: boolean
  disabled?: boolean
  placeholder?: string
}) {
  const [text, setText] = useState('')
  const [mentions, setMentions] = useState<Map<string, string>>(new Map())
  const [linked, setLinked] = useState<PickedRecord | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const suggestions = useMemo(() => {
    if (query === null) return []
    const needle = query.toLowerCase()
    return conversation.members
      .filter((member) => member.name)
      .filter(
        (member) =>
          !needle || (member.name ?? '').toLowerCase().includes(needle)
      )
      .slice(0, MAX_SUGGESTIONS)
  }, [conversation.members, query])

  const detect = (value: string) => {
    const match = value.match(MENTION_TOKEN)
    setQuery(match ? match[1] : null)
    setActiveIndex(0)
  }

  const pick = (member: ConversationMember) => {
    const name = member.name ?? 'someone'
    const replaced = text.replace(MENTION_TOKEN, (full) =>
      full.startsWith(' ') ? ` @${name} ` : `@${name} `
    )
    setText(replaced)
    setMentions((current) => new Map(current).set(member.userId, name))
    setQuery(null)
    textareaRef.current?.focus()
  }

  const mentionIds = () =>
    Array.from(mentions.entries())
      .filter(([, name]) => text.includes(`@${name}`))
      .map(([id]) => id)

  const submit = async () => {
    const body = text.trim()
    if ((!body && !linked) || pending || disabled) return
    await onSend({
      body,
      mentionUserIds: mentionIds(),
      linkedRecord: linked
        ? {
            recordType: linked.recordType,
            recordId: linked.recordId,
            projectId: linked.projectId,
            title: linked.title,
          }
        : null,
    })
    setText('')
    setMentions(new Map())
    setLinked(null)
    setQuery(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (query !== null && suggestions.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((index) => (index + 1) % suggestions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex(
          (index) => (index - 1 + suggestions.length) % suggestions.length
        )
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        pick(suggestions[activeIndex])
        return
      }
      if (event.key === 'Escape') {
        setQuery(null)
        return
      }
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <div className='relative space-y-2' data-testid='uat-message-composer'>
      {linked && (
        <div className='flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1 text-xs'>
          <Link2 className='h-3.5 w-3.5 shrink-0' />
          <span className='truncate'>
            {linked.typeLabel}: {linked.title}
          </span>
          <button
            type='button'
            className='ml-auto rounded p-0.5 hover:bg-muted'
            onClick={() => setLinked(null)}
            aria-label='Remove shared record'
          >
            <X className='h-3.5 w-3.5' />
          </button>
        </div>
      )}
      {query !== null && suggestions.length > 0 && (
        <ul
          role='listbox'
          className='absolute bottom-full left-0 z-20 mb-1 w-72 max-w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md'
        >
          {suggestions.map((member, index) => (
            <li
              key={member.userId}
              role='option'
              aria-selected={index === activeIndex}
              className={cn(
                'flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm',
                index === activeIndex && 'bg-accent text-accent-foreground'
              )}
              onMouseDown={(event) => {
                event.preventDefault()
                pick(member)
              }}
            >
              <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold'>
                {initials(member.name)}
              </span>
              <span className='truncate'>{member.name}</span>
            </li>
          ))}
        </ul>
      )}
      <Textarea
        ref={textareaRef}
        rows={2}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
          setText(event.target.value)
          detect(event.target.value)
        }}
        onKeyDown={onKeyDown}
        data-testid='uat-message-input'
      />
      <div className='flex items-center gap-1.5'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={disabled}
          onClick={() => {
            setText(
              (current) =>
                `${current}${current.endsWith(' ') || !current ? '' : ' '}@`
            )
            setQuery('')
            textareaRef.current?.focus()
          }}
        >
          <AtSign className='mr-1 h-4 w-4' /> Mention
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={disabled}
          onClick={() => setPickerOpen(true)}
          data-testid='uat-message-share-record'
        >
          <Link2 className='mr-1 h-4 w-4' /> Share record
        </Button>
        <Button
          type='button'
          size='sm'
          className='ml-auto'
          disabled={disabled || pending || (!text.trim() && !linked)}
          onClick={submit}
          data-testid='uat-message-send'
        >
          {pending ? (
            <Loader2 className='mr-1 h-4 w-4 animate-spin' />
          ) : (
            <Send className='mr-1 h-4 w-4' />
          )}
          Send
        </Button>
      </div>
      <RecordPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        projectId={conversation.projectId}
        onPick={setLinked}
      />
    </div>
  )
}
