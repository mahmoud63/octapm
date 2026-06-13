import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export type GlobalSearchType =
  | 'project'
  | 'activity'
  | 'boq'
  | 'rfi'
  | 'submittal'
  | 'drawing'
  | 'document'
  | 'change_order'
  | 'ipc'
  | 'risk'
  | 'procurement'
  | 'long_lead'
  | 'meeting'
  | 'task'

export interface GlobalSearchQuery {
  q?: string
  projectId?: string
  type?: GlobalSearchType | 'all'
  status?: string
  dateFrom?: string
  dateTo?: string
  limit?: number
}

export interface GlobalSearchResult {
  id: string
  type: GlobalSearchType
  typeLabel: string
  module: string
  projectId: string
  projectName: string
  title: string
  subtitle?: string | null
  identifier?: string | null
  status?: string | null
  date?: string | null
  url: string
  score: number
  metadata?: Record<string, unknown>
}

export interface GlobalSearchResponse {
  query: string | null
  items: GlobalSearchResult[]
  groups: Array<{
    type: GlobalSearchType
    label: string
    count: number
  }>
  meta: {
    limit: number
    total: number
    authorizedProjectCount: number
    searchableTypes: Array<{ type: GlobalSearchType; label: string }>
  }
}

const cleanSearchParams = (query: GlobalSearchQuery) =>
  Object.fromEntries(
    Object.entries(query).filter(([, value]) => {
      if (value === undefined || value === null || value === '') return false
      return value !== 'all'
    })
  )

export const useGlobalSearch = (
  query: GlobalSearchQuery,
  options: { enabled?: boolean } = {}
) =>
  useQuery<GlobalSearchResponse>({
    queryKey: ['global-search', query],
    queryFn: () =>
      apiClient
        .get('/search', { params: cleanSearchParams(query) })
        .then((response) => response.data.data),
    enabled: options.enabled ?? true,
    staleTime: 15_000,
  })
