import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Project knowledge assistant (OCTA-AI-ASSIST-028). Inside a project the
 * calls go to `/projects/{id}/assistant` (actions available); elsewhere to
 * `/assistant`, which searches every project the caller can open.
 */

export interface AssistantCitation {
  n: number
  id: string
  type: string
  typeLabel: string
  title: string
  ref: string | null
  projectId: string | null
  projectName: string | null
  url: string | null
  snippet: string | null
}

export interface AssistantAction {
  type: 'create_rfi' | 'create_task' | 'open'
  label: string
  sourceN: number | null
  url: string | null
  subject?: string | null
  question?: string | null
  title?: string | null
  description?: string | null
}

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: AssistantCitation[]
  actions: AssistantAction[]
  sources: Array<Record<string, unknown>>
  usage: { inputTokens?: number | null; outputTokens?: number | null } | null
  provider: string | null
  model: string | null
  feedback: 'up' | 'down' | null
  feedbackNote: string | null
  createdAt: string | null
}

export interface AssistantConversation {
  id: string
  projectId: string | null
  project: { id: string; name: string } | null
  title: string
  lastMessageAt: string | null
  messageCount: number | null
  createdAt: string | null
  updatedAt: string | null
  messages?: AssistantMessage[]
}

export interface AssistantAskResult {
  conversationId: string
  projectId: string | null
  title: string
  question: AssistantMessage
  message: AssistantMessage
  degraded: boolean
  retrieval: { sources: number; projects: string[]; mode: string | null }
}

export interface AssistantStatus {
  enabled: boolean
  provider: string | null
  model: string | null
  embeddings:
    | { enabled?: boolean; provider?: string | null }
    | Record<string, unknown>
}

const base = (projectId: string | null) =>
  projectId ? `/projects/${projectId}/assistant` : '/assistant'
const key = (projectId: string | null) =>
  ['assistant', projectId ?? 'org'] as const
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

export const useAssistantStatus = (projectId: string | null, enabled = true) =>
  useQuery<AssistantStatus>({
    queryKey: [...key(projectId), 'status'],
    queryFn: () =>
      data<AssistantStatus>(apiClient.get(`${base(projectId)}/status`)),
    staleTime: 5 * 60_000,
    enabled,
  })

export const useAssistantConversations = (
  projectId: string | null,
  enabled = true
) =>
  useQuery<AssistantConversation[]>({
    queryKey: [...key(projectId), 'conversations'],
    queryFn: () =>
      data<{ items: AssistantConversation[] }>(
        apiClient.get(`${base(projectId)}/conversations`)
      ).then((result) => result.items),
    enabled,
  })

export const useAssistantConversation = (
  projectId: string | null,
  conversationId: string | null
) =>
  useQuery<AssistantConversation>({
    queryKey: [...key(projectId), 'conversation', conversationId ?? ''],
    queryFn: () =>
      data<AssistantConversation>(
        apiClient.get(`${base(projectId)}/conversations/${conversationId}`)
      ),
    enabled: Boolean(conversationId),
  })

export const useAskAssistant = (projectId: string | null) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      question: string
      conversationId?: string | null
      /** The screen asked from (labels) and the record on it, when an AI action named one. */
      context?: {
        module: string | null
        child: string | null
        label: string | null
        recordType: string | null
        recordId: string | null
      } | null
    }) =>
      data<AssistantAskResult>(
        apiClient.post(`${base(projectId)}/ask`, payload, { timeout: 120_000 })
      ),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: [...key(projectId), 'conversations'] })
      qc.invalidateQueries({
        queryKey: [...key(projectId), 'conversation', result.conversationId],
      })
    },
  })
}

export const useDeleteAssistantConversation = (projectId: string | null) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (conversationId: string) =>
      data<{ deleted: boolean }>(
        apiClient.delete(`${base(projectId)}/conversations/${conversationId}`)
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  })
}

export const useAssistantFeedback = (projectId: string | null) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      messageId,
      rating,
      note,
    }: {
      messageId: string
      rating: 'up' | 'down' | null
      note?: string | null
    }) =>
      data<AssistantMessage>(
        apiClient.post(`${base(projectId)}/messages/${messageId}/feedback`, {
          rating,
          note: note ?? null,
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  })
}

export const useRunAssistantAction = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (action: AssistantAction) =>
      data<{
        type: string
        record: { id: string; ref: string | null; status: string | null }
        url: string
      }>(apiClient.post(`${base(projectId)}/actions`, { action })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rfis', projectId] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export type AnswerPart =
  | { kind: 'citation'; n: number }
  | { kind: 'text'; text: string }

/** Splits an answer into text and `[n]` citation markers for rendering. */
export const splitCitations = (content: string): AnswerPart[] =>
  content.split(/(\[\d+\])/g).map((part) => {
    const match = /^\[(\d+)\]$/.exec(part)
    return match
      ? { kind: 'citation', n: Number(match[1]) }
      : { kind: 'text', text: part }
  })
