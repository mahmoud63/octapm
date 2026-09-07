import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Subcontract closeout (OCTA-SUB-CLOSE-056).
 *
 * The last gate before a subcontractor is paid out and the subcontract closed.
 * Four checks are derived from records the system already holds and cannot be
 * ticked; the rest are handover documents somebody produces.
 */

export type CloseoutStatus = 'outstanding' | 'complete' | 'waived' | 'not_applicable'

export type CloseoutItem = {
  id: string | null
  key: string
  label: string
  source: 'derived' | 'handover'
  required: boolean
  status: CloseoutStatus
  /** What the derived check actually found, in words. */
  detail: string | null
  documentId: string | null
  note: string | null
  waivedReason: string | null
  completedAt: string | null
  sortOrder: number
}

export type Closeout = {
  id: string
  commitmentId: string
  commitmentRef: string
  status: 'open' | 'complete'
  notes: string | null
  completedAt: string | null
  currency: string
  ready: boolean
  outstanding: string[]
  summary: {
    total: number
    complete: number
    waived: number
    outstanding: number
    retentionHeld: number
  }
  items: CloseoutItem[]
}

const unwrap = <T,>(response: { data: { data: T } }) => response.data.data
const base = (projectId: string, commitmentId: string) =>
  `/projects/${projectId}/commitments/${commitmentId}/closeout`

export function useCloseout(projectId: string, commitmentId: string | null) {
  return useQuery({
    queryKey: ['closeout', projectId, commitmentId],
    queryFn: () => apiClient.get(base(projectId, commitmentId!)).then(unwrap<Closeout>),
    enabled: Boolean(projectId && commitmentId),
  })
}

/** Closing the subcontract depends on this, so both re-read together. */
const invalidate = (
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  commitmentId: string
) => {
  void queryClient.invalidateQueries({ queryKey: ['closeout', projectId, commitmentId] })
  void queryClient.invalidateQueries({ queryKey: ['commitments', projectId] })
}

export function useUpdateCloseoutItem(projectId: string, commitmentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      key,
      ...payload
    }: {
      key: string
      status?: CloseoutStatus
      documentId?: string | null
      note?: string | null
      waivedReason?: string | null
    }) =>
      apiClient
        .patch(`${base(projectId, commitmentId)}/items/${key}`, payload)
        .then(unwrap<Closeout>),
    onSuccess: () => invalidate(queryClient, projectId, commitmentId),
  })
}

export function useCloseoutDecision(projectId: string, commitmentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      action,
      ...payload
    }: {
      action: 'complete' | 'reopen'
      overrideReason?: string
      reason?: string
    }) =>
      apiClient
        .post(`${base(projectId, commitmentId)}/${action}`, payload)
        .then(unwrap<Closeout>),
    onSuccess: () => invalidate(queryClient, projectId, commitmentId),
  })
}
