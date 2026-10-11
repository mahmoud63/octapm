import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type {
  GlobalSearchResult,
  GlobalSearchType,
} from '@/features/search/hooks/use-global-search'

/**
 * Smart Search (AI-4): `/ai/search` reads a plain-language query into the
 * search's own filters and runs them under the caller's access. The
 * interpretation is returned so the reader sees what was searched.
 */

export interface SmartSearchInterpretation {
  keywords: string[]
  types: string[]
  statuses: string[]
  overdue: boolean
  project: { id: string; name: string } | null
  dateFrom: string | null
  interpretedBy: 'rules' | 'ai'
}

export interface SmartSearchCitation {
  n: number
  id: string
  type: string
  typeLabel: string
  title: string
  ref: string | null
  projectName: string | null
  url: string | null
}

export interface SmartSearchResponse {
  query: string
  interpretation: SmartSearchInterpretation
  items: Array<GlobalSearchResult & { reason?: string }>
  groups: Array<{ type: GlobalSearchType; label: string; count: number }>
  overdue: { count: number; shown: number } | null
  answer: {
    text: string
    citations: SmartSearchCitation[]
    provider: string | null
    mock: boolean
    label: string
  } | null
  degraded: boolean
}

const fetchSmartSearch = (q: string, explain: boolean) =>
  apiClient
    .get('/ai/search', { params: { q, ...(explain ? { explain: true } : {}) }, timeout: explain ? 120_000 : undefined })
    .then((response) => response.data.data as SmartSearchResponse)

export const useSmartSearch = (q: string, enabled: boolean) =>
  useQuery<SmartSearchResponse>({
    queryKey: ['smart-search', q],
    queryFn: () => fetchSmartSearch(q, false),
    enabled,
    staleTime: 30_000,
  })

/** The same search with an AI answer citing its results, on request. */
export const useExplainSearch = () =>
  useMutation({ mutationFn: (q: string) => fetchSmartSearch(q, true) })
