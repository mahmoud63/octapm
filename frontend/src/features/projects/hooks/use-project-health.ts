import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * GET /projects/:id/health — the Overview's health card, and the
 * earned-value cutoff the controls strip states its ledger figures against.
 * One query, shared through the cache.
 */
export const useProjectHealth = <T = unknown>(
  projectId: string,
  { enabled = true }: { enabled?: boolean } = {}
) =>
  useQuery<T>({
    queryKey: ['health', projectId],
    queryFn: () =>
      apiClient.get(`/projects/${projectId}/health`).then((r) => r.data.data),
    refetchInterval: 120000,
    enabled: Boolean(projectId) && enabled,
  })
