import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Subcontractor performance evaluation (OCTA-SUB-PERF-058).
 *
 * A `derived` criterion is recomputed from the records on every read and
 * carries a `detail` saying what it found. Giving it a `score` overrides that
 * reading and needs a reason; the reading it replaced stays visible as
 * `derivedScore`.
 *
 * A criterion with `score: null` and a `detail` is one there was nothing to
 * measure — it drops out of the weighting rather than scoring zero.
 */

export type EvaluationSource = 'derived' | 'rated'

export interface EvaluationCriterion {
  id: string | null
  key: string
  label: string
  category: string
  source: EvaluationSource
  hint: string | null
  weight: number
  maxScore: number
  score: number | null
  derivedScore: number | null
  detail: string | null
  overridden: boolean
  overrideReason: string | null
  note: string | null
  sortOrder: number
}

export interface Evaluation {
  id: string
  commitmentId: string
  commitmentRef: string
  commitmentTitle: string
  projectId: string
  company: { id: string; name: string } | null
  status: 'draft' | 'final'
  score: number | null
  weightScored: number
  wouldReuse: boolean | null
  summary: string | null
  evaluatedAt: string | null
  evaluatedBy: string | null
  ready: boolean
  gaps: string[]
  unmeasurable: string[]
  criteria: EvaluationCriterion[]
  createdAt: string | null
  updatedAt: string | null
}

export const evaluationKeys = {
  detail: (projectId: string, commitmentId: string) =>
    ['commitment-evaluation', projectId, commitmentId] as const,
}

const base = (projectId: string, commitmentId: string) =>
  `/projects/${projectId}/commitments/${commitmentId}/evaluation`

export const useEvaluation = (
  projectId: string,
  commitmentId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: evaluationKeys.detail(projectId, commitmentId),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: Evaluation }>(
        base(projectId, commitmentId)
      )
      return data.data
    },
    enabled: Boolean(projectId && commitmentId) && (options.enabled ?? true),
  })

const useInvalidate = (projectId: string, commitmentId: string) => {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: evaluationKeys.detail(projectId, commitmentId),
    })
    // The company's history moves with it.
    queryClient.invalidateQueries({ queryKey: ['company-prequalification'] })
    queryClient.invalidateQueries({ queryKey: ['vendor-performance'] })
  }
}

export const useScoreEvaluationCriterion = (
  projectId: string,
  commitmentId: string
) => {
  const invalidate = useInvalidate(projectId, commitmentId)
  return useMutation({
    mutationFn: async ({
      key,
      ...payload
    }: {
      key: string
      score?: number | null
      overrideReason?: string | null
      note?: string | null
    }) => {
      const { data } = await apiClient.patch<{ data: Evaluation }>(
        `${base(projectId, commitmentId)}/criteria/${key}`,
        payload
      )
      return data.data
    },
    onSuccess: invalidate,
  })
}

export const useEvaluationVerdict = (projectId: string, commitmentId: string) => {
  const invalidate = useInvalidate(projectId, commitmentId)
  return useMutation({
    mutationFn: async (payload: {
      wouldReuse?: boolean | null
      summary?: string | null
    }) => {
      const { data } = await apiClient.patch<{ data: Evaluation }>(
        base(projectId, commitmentId),
        payload
      )
      return data.data
    },
    onSuccess: invalidate,
  })
}

export const useEvaluationDecision = (
  projectId: string,
  commitmentId: string
) => {
  const invalidate = useInvalidate(projectId, commitmentId)
  return useMutation({
    mutationFn: async ({
      action,
      reason,
    }: {
      action: 'final' | 'reopen'
      reason?: string
    }) => {
      const { data } = await apiClient.post<{ data: Evaluation }>(
        `${base(projectId, commitmentId)}/${action}`,
        action === 'reopen' ? { reason } : {}
      )
      return data.data
    },
    onSuccess: invalidate,
  })
}
