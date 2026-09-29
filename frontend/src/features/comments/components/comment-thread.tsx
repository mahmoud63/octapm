import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import {
  AtSign,
  Bell,
  BellOff,
  CornerDownRight,
  MessageSquare,
  Pencil,
  Reply,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { moduleForRecordType } from '@/features/attachments/components/attachment-panel'
import {
  useProjectTeam,
  type ProjectTeamMember,
} from '@/features/permissions/hooks/use-permissions'
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useRecordSubscription,
  useSetSubscription,
  useUpdateComment,
  type RecordComment,
} from '../hooks/use-comments'

const MAX_SUGGESTIONS = 6
const MENTION_TOKEN = /(?:^|\s)@([^\s@]*)$/

interface Props {
  projectId: string
  recordType: string
  recordId: string
  title?: string
  className?: string
}

type MentionMap = Map<string, string>

const relativeTime = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} d ago`
  return new Date(iso).toLocaleDateString()
}

const initials = (name: string | null | undefined) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?'

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Highlights `@Name` for every user the comment actually mentions. */
function CommentBody({ comment }: { comment: RecordComment }) {
  const names = comment.mentions
    .map((mention) => mention.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => b.length - a.length)
  if (!names.length) {
    return (
      <p className='text-sm break-words whitespace-pre-wrap'>{comment.body}</p>
    )
  }
  const pattern = new RegExp(`(@(?:${names.map(escapeRegExp).join('|')}))`, 'g')
  const parts = comment.body.split(pattern)
  return (
    <p className='text-sm break-words whitespace-pre-wrap'>
      {parts.map((part, index) =>
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

function MentionSuggestions({
  members,
  activeIndex,
  onPick,
}: {
  members: ProjectTeamMember[]
  activeIndex: number
  onPick: (member: ProjectTeamMember) => void
}) {
  if (!members.length) return null
  return (
    <ul
      role='listbox'
      className='absolute bottom-full left-0 z-20 mb-1 w-72 max-w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md'
    >
      {members.map((member, index) => (
        <li
          key={member.userId}
          role='option'
          aria-selected={index === activeIndex}
          data-testid='uat-comment-mention-option'
          className={cn(
            'flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm',
            index === activeIndex && 'bg-accent text-accent-foreground'
          )}
          onMouseDown={(event) => {
            event.preventDefault()
            onPick(member)
          }}
        >
          <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold'>
            {initials(member.name)}
          </span>
          <span className='min-w-0 flex-1 truncate'>{member.name}</span>
          <span className='truncate text-xs text-muted-foreground'>
            {member.party?.companyName ||
              member.assignmentRole ||
              member.orgRole ||
              ''}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Text box with `@` autocomplete over the project team. Mentions are tracked
 * as explicit user ids (never parsed server-side), so the API notifies the
 * exact people picked here.
 */
function Composer({
  projectId,
  value,
  onChange,
  mentions,
  onMentionsChange,
  onSubmit,
  isPending,
  placeholder,
  autoFocus,
  submitLabel = 'Post',
  onCancel,
  testId,
}: {
  projectId: string
  value: string
  onChange: (value: string) => void
  mentions: MentionMap
  onMentionsChange: (next: MentionMap) => void
  onSubmit: () => void
  isPending: boolean
  placeholder: string
  autoFocus?: boolean
  submitLabel?: string
  onCancel?: () => void
  testId?: string
}) {
  const { data: team } = useProjectTeam(projectId)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const suggestions = useMemo(() => {
    if (query === null) return []
    const needle = query.toLowerCase()
    return (team?.items ?? [])
      .filter(
        (member) => member.status === 'active' && !mentions.has(member.userId)
      )
      .filter(
        (member) =>
          !needle ||
          member.name.toLowerCase().includes(needle) ||
          member.email.toLowerCase().includes(needle)
      )
      .slice(0, MAX_SUGGESTIONS)
  }, [mentions, query, team?.items])

  const detectMention = (text: string, caret: number) => {
    const match = MENTION_TOKEN.exec(text.slice(0, caret))
    setQuery(match ? match[1] : null)
    setActiveIndex(0)
  }

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value)
    detectMention(
      event.target.value,
      event.target.selectionStart ?? event.target.value.length
    )
  }

  const pick = (member: ProjectTeamMember) => {
    const element = textareaRef.current
    const caret = element?.selectionStart ?? value.length
    const before = value.slice(0, caret)
    const after = value.slice(caret)
    const match = MENTION_TOKEN.exec(before)
    const start = match
      ? before.length - match[0].length + (match[0].startsWith('@') ? 0 : 1)
      : caret
    const inserted = `@${member.name} `
    const next = `${value.slice(0, start)}${inserted}${after}`
    onChange(next)
    const nextMentions = new Map(mentions)
    nextMentions.set(member.userId, member.name)
    onMentionsChange(nextMentions)
    setQuery(null)
    requestAnimationFrame(() => {
      if (!element) return
      element.focus()
      const position = start + inserted.length
      element.setSelectionRange(position, position)
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
        pick(suggestions[activeIndex] ?? suggestions[0])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setQuery(null)
        return
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      onSubmit()
    }
  }

  const removeMention = (userId: string) => {
    const nextMentions = new Map(mentions)
    nextMentions.delete(userId)
    onMentionsChange(nextMentions)
  }

  return (
    <div className='space-y-2'>
      <div className='relative'>
        <MentionSuggestions
          members={suggestions}
          activeIndex={activeIndex}
          onPick={pick}
        />
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => setQuery(null)}
          onClick={(event) =>
            detectMention(
              event.currentTarget.value,
              event.currentTarget.selectionStart ?? 0
            )
          }
          placeholder={placeholder}
          autoFocus={autoFocus}
          rows={3}
          maxLength={5000}
          data-testid={testId ?? 'uat-comment-input'}
          className='min-h-[72px] text-sm'
        />
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        {[...mentions.entries()].map(([userId, name]) => (
          <Badge key={userId} variant='secondary' className='gap-1 font-normal'>
            <AtSign className='h-3 w-3' />
            {name}
            <button
              type='button'
              className='ml-0.5 rounded-sm opacity-70 hover:opacity-100'
              aria-label={`Remove mention of ${name}`}
              onClick={() => removeMention(userId)}
            >
              <X className='h-3 w-3' />
            </button>
          </Badge>
        ))}
        <span className='ml-auto text-xs text-muted-foreground'>
          Type @ to mention someone · Ctrl+Enter to {submitLabel.toLowerCase()}
        </span>
        {onCancel && (
          <Button type='button' size='sm' variant='ghost' onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type='button'
          size='sm'
          onClick={onSubmit}
          disabled={isPending || !value.trim()}
          data-testid={testId ? `${testId}-submit` : 'uat-comment-post'}
        >
          <Send className='mr-2 h-4 w-4' />
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

function FollowButton({
  projectId,
  recordType,
  recordId,
}: {
  projectId: string
  recordType: string
  recordId: string
}) {
  const { data } = useRecordSubscription(projectId, recordType, recordId)
  const setSubscription = useSetSubscription(projectId)
  const following = data?.following ?? false
  const names = (data?.subscribers ?? [])
    .map((row) => row.user?.name)
    .filter(Boolean)
    .join(', ')

  return (
    <Button
      type='button'
      size='sm'
      variant={following ? 'secondary' : 'outline'}
      title={names ? `Following: ${names}` : 'Nobody follows this record yet'}
      disabled={setSubscription.isPending}
      data-testid='uat-comment-follow'
      onClick={() =>
        setSubscription.mutate(
          { recordType, recordId, follow: !following },
          {
            onError: (error) => toast.error(getServerErrorMessage(error)),
          }
        )
      }
    >
      {following ? (
        <BellOff className='mr-2 h-4 w-4' />
      ) : (
        <Bell className='mr-2 h-4 w-4' />
      )}
      {following ? 'Following' : 'Follow'}
      {typeof data?.count === 'number' && (
        <Badge variant='outline' className='ml-2 px-1.5 py-0 text-[10px]'>
          {data.count}
        </Badge>
      )}
    </Button>
  )
}

function CommentItem({
  projectId,
  comment,
  parentAuthor,
  onReply,
  onEdit,
  onDelete,
  isDeleting,
}: {
  projectId: string
  comment: RecordComment
  parentAuthor: string | null
  onReply: (comment: RecordComment) => void
  onEdit: (comment: RecordComment, body: string) => Promise<void>
  onDelete: (comment: RecordComment) => void
  isDeleting: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [saving, setSaving] = useState(false)
  const [draftMentions, setDraftMentions] = useState<MentionMap>(
    () =>
      new Map(
        comment.mentions
          .filter((mention) => mention.name)
          .map((mention) => [mention.userId, mention.name as string])
      )
  )

  const save = async () => {
    if (!draft.trim()) return
    setSaving(true)
    try {
      await onEdit(comment, draft.trim())
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li
      data-testid='uat-comment-item'
      className={cn('flex gap-3 py-3', comment.parentId && 'pl-6')}
    >
      <span className='mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold'>
        {initials(comment.author?.name)}
      </span>
      <div className='min-w-0 flex-1 space-y-1'>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground'>
          <span className='font-medium text-foreground'>
            {comment.author?.name || 'Former member'}
          </span>
          <span title={new Date(comment.createdAt).toLocaleString()}>
            {relativeTime(comment.createdAt)}
          </span>
          {comment.editedAt && <span>(edited)</span>}
          {parentAuthor && (
            <span className='inline-flex items-center gap-1'>
              <CornerDownRight className='h-3 w-3' />
              replying to {parentAuthor}
            </span>
          )}
          <span className='ml-auto flex items-center gap-1'>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              className='size-6'
              title='Reply'
              aria-label='Reply'
              onClick={() => onReply(comment)}
            >
              <Reply className='h-3.5 w-3.5' />
            </Button>
            {comment.canEdit && !editing && (
              <Button
                type='button'
                size='icon'
                variant='ghost'
                className='size-6'
                title='Edit'
                aria-label='Edit comment'
                onClick={() => setEditing(true)}
              >
                <Pencil className='h-3.5 w-3.5' />
              </Button>
            )}
            {comment.canDelete && (
              <Button
                type='button'
                size='icon'
                variant='ghost'
                className='size-6 text-destructive hover:text-destructive'
                title='Remove'
                aria-label='Remove comment'
                disabled={isDeleting}
                onClick={() => onDelete(comment)}
              >
                <Trash2 className='h-3.5 w-3.5' />
              </Button>
            )}
          </span>
        </div>
        {editing ? (
          <Composer
            projectId={projectId}
            value={draft}
            onChange={setDraft}
            mentions={draftMentions}
            onMentionsChange={setDraftMentions}
            onSubmit={save}
            isPending={saving}
            placeholder='Edit your comment'
            submitLabel='Save'
            autoFocus
            onCancel={() => {
              setEditing(false)
              setDraft(comment.body)
            }}
            testId={`uat-comment-edit-${comment.id}`}
          />
        ) : (
          <CommentBody comment={comment} />
        )}
      </div>
    </li>
  )
}

/**
 * Discussion thread for one record: comments with @mentions, follow /
 * unfollow, inline edit and removal. Anyone who can read the record can take
 * part; the server enforces authorship for edits.
 */
export function CommentThread({
  projectId,
  recordType,
  recordId,
  title = 'Discussion',
  className,
}: Props) {
  const canRead = useCanPerform(moduleForRecordType(recordType), 'read')
  const currentUser = useAuthStore((state) => state.auth.user)
  const { data, isLoading } = useComments(projectId, recordType, recordId, {
    enabled: canRead,
  })
  const createComment = useCreateComment(projectId)
  const updateComment = useUpdateComment(projectId)
  const deleteComment = useDeleteComment(projectId)

  const [value, setValue] = useState('')
  const [mentions, setMentions] = useState<MentionMap>(new Map())
  const [replyTo, setReplyTo] = useState<RecordComment | null>(null)
  // The server's word on mentioned people it did not notify (a BOQ record's
  // discussion reaches only readers of the BOQ): shown until dismissed or
  // the next comment.
  const [notNotified, setNotNotified] = useState<string | null>(null)

  const comments = useMemo(() => data?.items ?? [], [data?.items])
  const authorById = useMemo(
    () =>
      new Map(
        comments.map((comment) => [
          comment.id,
          comment.author?.name || 'Former member',
        ])
      ),
    [comments]
  )

  if (!canRead) return null

  const submit = () => {
    const body = value.trim()
    if (!body) return
    const mentionUserIds = [...mentions.entries()]
      .filter(([, name]) => body.includes(`@${name}`))
      .map(([userId]) => userId)
    createComment.mutate(
      {
        recordType,
        recordId,
        body,
        mentionUserIds,
        parentId: replyTo?.id ?? null,
      },
      {
        onSuccess: (saved) => {
          setValue('')
          setMentions(new Map())
          setReplyTo(null)
          setNotNotified(saved.notNotified?.message ?? null)
        },
        onError: (error) => toast.error(getServerErrorMessage(error)),
      }
    )
  }

  const startReply = (comment: RecordComment) => {
    setReplyTo(comment)
    if (comment.author && comment.author.id !== currentUser?.id) {
      const next = new Map(mentions)
      next.set(comment.author.id, comment.author.name)
      setMentions(next)
      const mentionText = `@${comment.author.name} `
      setValue((current) =>
        current.includes(mentionText) ? current : `${mentionText}${current}`
      )
    }
  }

  const edit = async (comment: RecordComment, body: string) => {
    try {
      await updateComment.mutateAsync({
        recordType,
        recordId,
        commentId: comment.id,
        body,
      })
    } catch (error) {
      toast.error(getServerErrorMessage(error))
      throw error
    }
  }

  const remove = (comment: RecordComment) => {
    if (!window.confirm('Remove this comment? It stays in the audit log.'))
      return
    deleteComment.mutate(
      { recordType, recordId, commentId: comment.id },
      { onError: (error) => toast.error(getServerErrorMessage(error)) }
    )
  }

  return (
    <section
      className={cn('rounded-md border', className)}
      data-testid='uat-comment-thread'
    >
      <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
        <MessageSquare className='h-4 w-4 shrink-0 text-muted-foreground' />
        <h3 className='text-sm font-semibold'>{title}</h3>
        <Badge variant='outline'>{comments.length}</Badge>
        <div className='ml-auto'>
          <FollowButton
            projectId={projectId}
            recordType={recordType}
            recordId={recordId}
          />
        </div>
      </div>
      <div className='px-3'>
        {isLoading ? (
          <p className='py-4 text-sm text-muted-foreground'>
            Loading comments…
          </p>
        ) : comments.length === 0 ? (
          <p className='py-4 text-sm text-muted-foreground'>
            No comments yet. Start the conversation — @mention a teammate to
            bring them in.
          </p>
        ) : (
          <ul className='divide-y'>
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                projectId={projectId}
                comment={comment}
                parentAuthor={
                  comment.parentId
                    ? (authorById.get(comment.parentId) ?? null)
                    : null
                }
                onReply={startReply}
                onEdit={edit}
                onDelete={remove}
                isDeleting={deleteComment.isPending}
              />
            ))}
          </ul>
        )}
      </div>
      <div className='border-t px-3 py-3'>
        {notNotified && (
          <div
            role='status'
            className='mb-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
            data-testid='comment-not-notified'
          >
            <BellOff className='mt-0.5 h-3.5 w-3.5 shrink-0' />
            <span className='flex-1'>{notNotified}</span>
            <button
              type='button'
              className='rounded-sm opacity-70 hover:opacity-100'
              aria-label='Dismiss'
              onClick={() => setNotNotified(null)}
            >
              <X className='h-3 w-3' />
            </button>
          </div>
        )}
        {replyTo && (
          <div className='mb-2 flex items-center gap-2 text-xs text-muted-foreground'>
            <CornerDownRight className='h-3 w-3' />
            Replying to {replyTo.author?.name || 'comment'}
            <button
              type='button'
              className='rounded-sm opacity-70 hover:opacity-100'
              aria-label='Cancel reply'
              onClick={() => setReplyTo(null)}
            >
              <X className='h-3 w-3' />
            </button>
          </div>
        )}
        <Composer
          projectId={projectId}
          value={value}
          onChange={setValue}
          mentions={mentions}
          onMentionsChange={setMentions}
          onSubmit={submit}
          isPending={createComment.isPending}
          placeholder='Add a comment…'
        />
      </div>
    </section>
  )
}
