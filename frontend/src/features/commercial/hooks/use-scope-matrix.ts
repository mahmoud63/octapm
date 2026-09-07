import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * The scope and responsibility matrix (OCTA-SUB-SCOPE-054).
 *
 * Agreed before the subcontract is written and carried into it, so a boundary
 * is settled once rather than argued about later.
 */

export const SCOPE_KINDS = [
  'scope',
  'responsibility',
  'inclusion',
  'exclusion',
  'clarification',
  'interface',
] as const
export type ScopeKind = (typeof SCOPE_KINDS)[number]

export const KIND_LABEL: Record<ScopeKind, string> = {
  scope: 'Scope',
  responsibility: 'Responsibility',
  inclusion: 'Inclusions',
  exclusion: 'Exclusions',
  clarification: 'Clarifications',
  interface: 'Interfaces',
}

/** Only these allocate work; the rest are statements about the boundary. */
export const ALLOCATED_KINDS: ScopeKind[] = ['scope', 'responsibility']

export const PARTIES = ['gc', 'subcontractor', 'by_others', 'shared', 'not_applicable'] as const
export type ScopeParty = (typeof PARTIES)[number]

export const PARTY_LABEL: Record<ScopeParty, string> = {
  gc: 'Main contractor',
  subcontractor: 'Subcontractor',
  by_others: 'By others',
  shared: 'Shared',
  not_applicable: 'Not applicable',
}

/** Short forms for the matrix columns, where the row already gives context. */
export const PARTY_SHORT: Record<ScopeParty, string> = {
  gc: 'GC',
  subcontractor: 'Sub',
  by_others: 'Others',
  shared: 'Shared',
  not_applicable: 'N/A',
}

export type ScopeItem = {
  id: string
  kind: ScopeKind
  section: string | null
  description: string
  responsibility: ScopeParty | null
  responsibilityLabel: string | null
  notes: string | null
  sortOrder: number
}

export type ScopeMatrix = {
  id: string
  projectId: string
  commitmentId: string | null
  bidPackageId: string | null
  title: string
  status: 'draft' | 'agreed'
  notes: string | null
  agreedAt: string | null
  summary: {
    total: number
    allocated: number
    unallocated: number
    byParty: Record<ScopeParty, number>
    byKind: Record<ScopeKind, number>
  }
  items: ScopeItem[]
}

const unwrap = <T,>(response: { data: { data: T } }) => response.data.data
const base = (projectId: string, commitmentId: string) =>
  `/projects/${projectId}/commitments/${commitmentId}/scope`

export function useScopeMatrix(projectId: string, commitmentId: string | null) {
  return useQuery({
    queryKey: ['scope-matrix', projectId, commitmentId],
    queryFn: () => apiClient.get(base(projectId, commitmentId!)).then(unwrap<ScopeMatrix>),
    enabled: Boolean(projectId && commitmentId),
  })
}

export function useSaveScopeMatrix(projectId: string, commitmentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      items: Array<Partial<ScopeItem> & { description: string }>
      notes?: string | null
    }) => apiClient.put(base(projectId, commitmentId), payload).then(unwrap<ScopeMatrix>),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['scope-matrix', projectId, commitmentId] }),
  })
}

export function useScopeDecision(projectId: string, commitmentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ action, reason }: { action: 'agree' | 'reopen'; reason?: string }) =>
      apiClient
        .post(`${base(projectId, commitmentId)}/${action}`, reason ? { reason } : {})
        .then(unwrap<ScopeMatrix>),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['scope-matrix', projectId, commitmentId] }),
  })
}
