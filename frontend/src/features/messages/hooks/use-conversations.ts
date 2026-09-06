import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Conversations (OCTA-COMM-CONV-042): direct, group and per-record threads,
 * organisation-wide or scoped to a project.
 */

export type ConversationKind = 'direct' | 'group' | 'record'
export type ConversationFilter = 'all' | 'unread' | 'starred' | 'archived'
export type MessageKind = 'text' | 'system' | 'email'

export interface ConversationMember {
  userId: string
  name: string | null
  email: string | null
  role: string | null
  memberRole: 'member' | 'admin'
  joinedAt: string | null
  lastReadAt: string | null
}

export interface Conversation {
  id: string
  projectId: string | null
  project: { id: string; name: string } | null
  kind: ConversationKind
  title: string
  rawTitle: string | null
  recordType: string | null
  recordId: string | null
  recordTitle: string | null
  recordPath: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  messageCount: number
  archivedAt: string | null
  members: ConversationMember[]
  me: {
    memberRole: string
    lastReadAt: string | null
    starred: boolean
    muted: boolean
  } | null
  unread: number
  path: string
  createdBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface LinkedRecord {
  recordType: string
  recordId: string
  title: string | null
  projectId: string | null
  path: string | null
}

export interface LinkedRecordInput {
  recordType: string
  recordId: string
  projectId?: string | null
  title?: string | null
}

export interface ConversationMessage {
  id: string
  conversationId: string
  authorId: string | null
  author: { id: string; name: string; email: string | null } | null
  kind: MessageKind
  body: string
  mentions: Array<{ userId: string; name: string | null }>
  linkedRecord: LinkedRecord | null
  inboundEmailId: string | null
  editedAt: string | null
  deletedAt: string | null
  isMine: boolean
  createdAt: string | null
}

export interface ConversationPerson {
  id: string
  name: string
  email: string
  role: string | null
}

export interface ConversationListResponse {
  items: Conversation[]
  summary: {
    count: number
    unreadConversations: number
    unreadMessages: number
  }
}

export interface MessagesPage {
  items: ConversationMessage[]
  nextCursor: string | null
}

const base = '/conversations'
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)
const clean = (params: Record<string, string | number | undefined | null>) =>
  Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== null && value !== ''
    )
  )

export const conversationKeys = {
  all: ['conversations'] as const,
  list: (params: Record<string, string | undefined>) =>
    ['conversations', 'list', params] as const,
  one: (id: string) => ['conversations', 'one', id] as const,
  messages: (id: string) => ['conversations', 'messages', id] as const,
  people: (projectId: string | null, q: string) =>
    ['conversations', 'people', projectId ?? 'org', q] as const,
  unread: ['conversations', 'unread'] as const,
}

const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: conversationKeys.all })
}

export const useConversations = (params: {
  filter?: ConversationFilter
  projectId?: string | null
  q?: string
}) =>
  useQuery<ConversationListResponse>({
    queryKey: conversationKeys.list({
      filter: params.filter ?? 'all',
      projectId: params.projectId ?? undefined,
      q: params.q ?? undefined,
    }),
    queryFn: () =>
      data(
        apiClient.get(base, {
          params: clean({
            filter: params.filter,
            projectId: params.projectId,
            q: params.q,
          }),
        })
      ),
    placeholderData: (previous) => previous,
  })

export const useConversation = (id: string | null) =>
  useQuery<Conversation>({
    queryKey: conversationKeys.one(id ?? ''),
    queryFn: () => data(apiClient.get(`${base}/${id}`)),
    enabled: Boolean(id),
  })

export const useConversationMessages = (id: string | null) =>
  useQuery<MessagesPage>({
    queryKey: conversationKeys.messages(id ?? ''),
    queryFn: () =>
      data(apiClient.get(`${base}/${id}/messages`, { params: { limit: 100 } })),
    enabled: Boolean(id),
  })

/** Older messages before `cursor` (the first message id of the page shown). */
export const fetchOlderMessages = (id: string, cursor: string) =>
  data<MessagesPage>(
    apiClient.get(`${base}/${id}/messages`, { params: { cursor, limit: 100 } })
  )

export const useConversationPeople = (
  projectId: string | null,
  q: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery<{ items: ConversationPerson[] }>({
    queryKey: conversationKeys.people(projectId, q),
    queryFn: () =>
      data(
        apiClient.get(`${base}/people`, {
          params: clean({ projectId, q, limit: 100 }),
        })
      ),
    enabled: options.enabled ?? true,
    staleTime: 30_000,
  })

export const useUnreadMessages = (options: { enabled?: boolean } = {}) =>
  useQuery<{ unreadConversations: number; unreadMessages: number }>({
    queryKey: conversationKeys.unread,
    queryFn: () => data(apiClient.get(`${base}/unread`)),
    enabled: options.enabled ?? true,
    refetchInterval: 60_000,
  })

export const useCreateConversation = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      kind: ConversationKind
      projectId?: string | null
      title?: string | null
      memberUserIds: string[]
      recordType?: string | null
      recordId?: string | null
      message?: string | null
    }) => data<Conversation>(apiClient.post(base, payload)),
    onSuccess: () => invalidate(qc),
  })
}

export const useUpdateConversation = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string
      title?: string | null
      archived?: boolean
    }) => data<Conversation>(apiClient.patch(`${base}/${id}`, payload)),
    onSuccess: () => invalidate(qc),
  })
}

export const useAddConversationMembers = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, userIds }: { id: string; userIds: string[] }) =>
      data<Conversation>(apiClient.post(`${base}/${id}/members`, { userIds })),
    onSuccess: () => invalidate(qc),
  })
}

export const useRemoveConversationMember = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) =>
      data<Conversation | { left: boolean }>(
        apiClient.delete(`${base}/${id}/members/${userId}`)
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useSetConversationFlags = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string
      starred?: boolean
      muted?: boolean
    }) => data<Conversation>(apiClient.patch(`${base}/${id}/me`, payload)),
    onSuccess: () => invalidate(qc),
  })
}

export const useMarkConversationRead = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      data<{ conversationId: string; unread: number }>(
        apiClient.post(`${base}/${id}/read`, {})
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations', 'list'] })
      qc.invalidateQueries({ queryKey: conversationKeys.unread })
    },
  })
}

export const useSendMessage = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string
      body?: string | null
      mentionUserIds?: string[]
      linkedRecord?: LinkedRecordInput | null
    }) =>
      data<ConversationMessage>(
        apiClient.post(`${base}/${id}/messages`, payload)
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useEditMessage = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      messageId,
      body,
    }: {
      id: string
      messageId: string
      body: string
    }) =>
      data<ConversationMessage>(
        apiClient.patch(`${base}/${id}/messages/${messageId}`, { body })
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const useDeleteMessage = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, messageId }: { id: string; messageId: string }) =>
      data<{ deleted: boolean }>(
        apiClient.delete(`${base}/${id}/messages/${messageId}`)
      ),
    onSuccess: () => invalidate(qc),
  })
}

export const initials = (name: string | null | undefined) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?'

export const relativeTime = (iso: string | null | undefined) => {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} d`
  return new Date(iso).toLocaleDateString()
}
