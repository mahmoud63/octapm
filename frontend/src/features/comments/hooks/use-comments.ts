import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export interface CommentAuthor {
  id: string
  name: string
  email?: string | null
}

export interface CommentMention {
  userId: string
  name: string | null
  email?: string | null
}

export interface RecordComment {
  id: string
  projectId: string
  recordType: string
  recordId: string
  parentId: string | null
  body: string
  author: CommentAuthor | null
  authorId: string | null
  mentions: CommentMention[]
  editedAt: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  canEdit: boolean
  canDelete: boolean
}

export interface CommentPage {
  items: RecordComment[]
  pagination: { limit: number; nextCursor: string | null }
}

export interface RecordSubscription {
  id: string
  projectId: string
  recordType: string
  recordId: string
  userId: string
  user: CommentAuthor | null
  reason: 'manual' | 'created' | 'commented' | 'mentioned' | 'assigned'
  muted: boolean
  path: string | null
  createdAt: string
  updatedAt: string
  label?: string
}

export interface SubscriptionState {
  recordType: string
  recordId: string
  following: boolean
  subscription: RecordSubscription | null
  subscribers: RecordSubscription[]
  count: number
}

/** Query keys keep projectId at index 1 so realtime invalidation reaches them. */
export const commentKeys = {
  record: (projectId: string, recordType: string, recordId: string) =>
    ['comments', projectId, recordType, recordId] as const,
  subscription: (projectId: string, recordType: string, recordId: string) =>
    ['record-subscription', projectId, recordType, recordId] as const,
  mine: (projectId: string) =>
    ['record-subscriptions', projectId, 'mine'] as const,
}

export interface CommentTarget {
  recordType: string
  recordId: string
}

const invalidateRecord = (
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  target: CommentTarget
) => {
  queryClient.invalidateQueries({
    queryKey: commentKeys.record(projectId, target.recordType, target.recordId),
  })
  queryClient.invalidateQueries({
    queryKey: commentKeys.subscription(
      projectId,
      target.recordType,
      target.recordId
    ),
  })
  queryClient.invalidateQueries({ queryKey: commentKeys.mine(projectId) })
  // Comments are part of the record history feed.
  queryClient.invalidateQueries({ queryKey: ['audit-events', projectId] })
}

export const useComments = (
  projectId: string,
  recordType: string,
  recordId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery<CommentPage>({
    queryKey: commentKeys.record(projectId, recordType, recordId),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: CommentPage }>(
        `/projects/${projectId}/comments`,
        { params: { recordType, recordId, limit: 200, order: 'asc' } }
      )
      return data.data
    },
    enabled:
      (options.enabled ?? true) && Boolean(projectId && recordType && recordId),
  })

export interface CreateCommentInput extends CommentTarget {
  body: string
  mentionUserIds?: string[]
  parentId?: string | null
}

export const useCreateComment = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateCommentInput) => {
      const { data } = await apiClient.post<{ data: RecordComment }>(
        `/projects/${projectId}/comments`,
        input
      )
      return data.data
    },
    onSuccess: (_result, input) =>
      invalidateRecord(queryClient, projectId, input),
  })
}

export interface UpdateCommentInput extends CommentTarget {
  commentId: string
  body?: string
  mentionUserIds?: string[]
}

export const useUpdateComment = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      commentId,
      body,
      mentionUserIds,
    }: UpdateCommentInput) => {
      const { data } = await apiClient.patch<{ data: RecordComment }>(
        `/projects/${projectId}/comments/${commentId}`,
        { body, mentionUserIds }
      )
      return data.data
    },
    onSuccess: (_result, input) =>
      invalidateRecord(queryClient, projectId, input),
  })
}

export interface DeleteCommentInput extends CommentTarget {
  commentId: string
}

export const useDeleteComment = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ commentId }: DeleteCommentInput) => {
      const { data } = await apiClient.delete<{
        data: { deleted: boolean; id: string }
      }>(`/projects/${projectId}/comments/${commentId}`)
      return data.data
    },
    onSuccess: (_result, input) =>
      invalidateRecord(queryClient, projectId, input),
  })
}

export const useRecordSubscription = (
  projectId: string,
  recordType: string,
  recordId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery<SubscriptionState>({
    queryKey: commentKeys.subscription(projectId, recordType, recordId),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: SubscriptionState }>(
        `/projects/${projectId}/subscriptions`,
        { params: { recordType, recordId } }
      )
      return data.data
    },
    enabled:
      (options.enabled ?? true) && Boolean(projectId && recordType && recordId),
  })

export const useSetSubscription = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CommentTarget & { follow: boolean }) => {
      const { data } = await apiClient.put<{ data: SubscriptionState }>(
        `/projects/${projectId}/subscriptions`,
        input
      )
      return data.data
    },
    onSuccess: (result, input) => {
      queryClient.setQueryData(
        commentKeys.subscription(projectId, input.recordType, input.recordId),
        result
      )
      queryClient.invalidateQueries({ queryKey: commentKeys.mine(projectId) })
    },
  })
}

export const useMySubscriptions = (
  projectId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery<{ items: RecordSubscription[] }>({
    queryKey: commentKeys.mine(projectId),
    queryFn: async () => {
      const { data } = await apiClient.get<{
        data: { items: RecordSubscription[] }
      }>(`/projects/${projectId}/subscriptions/mine`)
      return data.data
    },
    enabled: (options.enabled ?? true) && Boolean(projectId),
  })
