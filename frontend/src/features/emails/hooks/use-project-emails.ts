import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { Conversation } from '@/features/messages/hooks/use-conversations'

/** Project emails (OCTA-COMM-CONV-042): the inbox behind p-<token>@<domain>. */

export type InboundEmailStatus =
  | 'received'
  | 'posted'
  | 'logged'
  | 'linked'
  | 'ignored'
  | 'unmatched'
  | 'rejected'
export type InboundEmailTarget = 'project' | 'record' | 'conversation'

export const EMAIL_STATUS_LABEL: Record<InboundEmailStatus, string> = {
  received: 'Needs action',
  posted: 'Posted on record',
  logged: 'Logged',
  linked: 'In a conversation',
  ignored: 'Ignored',
  unmatched: 'Unknown sender',
  rejected: 'Failed',
}

export interface InboundEmailAttachment {
  name: string
  contentType: string
  size: number | null
  stored: boolean
  attachmentId: string | null
  documentId: string | null
}

export interface InboundEmail {
  id: string
  projectId: string | null
  provider: string
  messageId: string | null
  from: { email: string; name: string | null }
  to: Array<{ email: string; name: string | null }>
  cc: Array<{ email: string; name: string | null }>
  subject: string
  preview: string
  textBody?: string
  htmlBody?: string | null
  replyText?: string | null
  attachments: InboundEmailAttachment[]
  attachmentCount: number
  receivedAt: string | null
  status: InboundEmailStatus
  target: InboundEmailTarget | null
  recordType: string | null
  recordId: string | null
  recordPath: string | null
  conversationId: string | null
  conversationPath: string | null
  commentId: string | null
  correspondenceId: string | null
  correspondencePath: string | null
  senderUserId: string | null
  error: string | null
  processedAt: string | null
  createdAt: string | null
}

export interface InboundEmailSettings {
  configured: boolean
  domain: string | null
  address: string | null
  autoLog: boolean
  repliesToRecords: boolean
  providers: string[]
  webhookPath: string
}

const base = (projectId: string) => `/projects/${projectId}/emails`
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

export const emailKeys = {
  all: (projectId: string) => ['project-emails', projectId] as const,
  list: (projectId: string, query: Record<string, string | undefined>) =>
    ['project-emails', projectId, 'list', query] as const,
  one: (projectId: string, id: string) =>
    ['project-emails', projectId, 'one', id] as const,
  settings: (projectId: string) =>
    ['project-emails', projectId, 'settings'] as const,
}

const invalidate = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: emailKeys.all(projectId) })
  qc.invalidateQueries({ queryKey: ['conversations'] })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
}

export const useProjectEmails = (
  projectId: string,
  query: { status?: string; target?: string; q?: string } = {}
) =>
  useQuery<{
    items: InboundEmail[]
    summary: {
      count: number
      byStatus: Record<InboundEmailStatus, number>
      needsAttention: number
    }
  }>({
    queryKey: emailKeys.list(projectId, query),
    queryFn: () =>
      data(
        apiClient.get(base(projectId), {
          params: Object.fromEntries(
            Object.entries(query).filter(([, value]) => value && value.trim())
          ),
        })
      ),
    enabled: Boolean(projectId),
    placeholderData: (previous) => previous,
  })

export const useProjectEmail = (projectId: string, id: string | null) =>
  useQuery<InboundEmail>({
    queryKey: emailKeys.one(projectId, id ?? ''),
    queryFn: () => data(apiClient.get(`${base(projectId)}/${id}`)),
    enabled: Boolean(projectId && id),
  })

export const useEmailSettings = (projectId: string) =>
  useQuery<InboundEmailSettings>({
    queryKey: emailKeys.settings(projectId),
    queryFn: () => data(apiClient.get(`${base(projectId)}/settings`)),
    enabled: Boolean(projectId),
  })

export const useUpdateEmailSettings = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { autoLog?: boolean }) =>
      data<InboundEmailSettings>(
        apiClient.patch(`${base(projectId)}/settings`, payload)
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useRotateEmailAddress = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      data<InboundEmailSettings>(
        apiClient.post(`${base(projectId)}/settings/rotate`, {})
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useEmailAction = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      action,
      body,
    }: {
      id: string
      action: 'log' | 'post' | 'conversation' | 'ignore'
      body?: Record<string, unknown>
    }) =>
      data<InboundEmail | { email: InboundEmail; conversation: Conversation }>(
        apiClient.post(`${base(projectId)}/${id}/${action}`, body ?? {})
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useDeleteEmail = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      data<{ deleted: boolean }>(apiClient.delete(`${base(projectId)}/${id}`)),
    onSuccess: () => invalidate(qc, projectId),
  })
}
