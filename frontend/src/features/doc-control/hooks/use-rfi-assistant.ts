import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { AssistantCitation } from '@/features/assistant/hooks/use-assistant'

/**
 * RFI drafting and response assistant (OCTA-AI-RFI-029). Every call is a
 * proposal: the form or the reply box is filled, nothing is saved until the
 * person submits it.
 */

export interface SimilarRfi {
  n: number
  id: string
  ref: string | null
  subject: string
  status: string | null
  projectId: string | null
  projectName: string | null
  url: string | null
  snippet: string | null
  sameProject: boolean
}

export interface RfiAiRunMessage {
  id: string
  provider: string | null
  model: string | null
  feedback: 'up' | 'down' | null
}

export interface RfiAlreadyAnswered {
  n: number
  id: string
  type: string
  typeLabel: string
  ref: string | null
  title: string
  url: string | null
  projectName: string | null
  why: string | null
}

export interface RfiDraft {
  subject: string
  question: string
  questionPlain: string
  discipline: string | null
  specSection: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  costImpact: boolean
  scheduleImpactFlag: boolean
  impactReason: string | null
  alreadyAnswered: RfiAlreadyAnswered[]
  citations: AssistantCitation[]
}

export interface RfiDraftResult {
  degraded: boolean
  reason?: string | null
  draft: RfiDraft | null
  similar: SimilarRfi[]
  citations: AssistantCitation[]
  message: RfiAiRunMessage | null
}

export type RfiImpactLevel = 'none' | 'possible' | 'likely'

export interface RfiSuggestion {
  response: string
  responsePlain: string
  confidence: 'high' | 'medium' | 'low'
  basis: string[]
  conflicts: Array<{ description: string; sourceNs: number[] }>
  openPoints: string[]
  impacts: {
    cost: RfiImpactLevel
    schedule: RfiImpactLevel
    reason: string | null
  }
  citations: AssistantCitation[]
}

export interface RfiSuggestionResult {
  degraded: boolean
  reason?: string | null
  rfi?: { id: string; ref: string; status: string; revision: number } | null
  suggestion: RfiSuggestion | null
  similar: SimilarRfi[]
  citations: AssistantCitation[]
  message: RfiAiRunMessage | null
}

export interface RfiSummary {
  summary: string
  decisions: string[]
  openPoints: string[]
  suggestedNextStep: string | null
  suggestedStatus: 'open' | 'answered' | 'closed' | null
}

export interface RfiSummaryResult {
  degraded: boolean
  reason?: string | null
  summary: RfiSummary
  message: RfiAiRunMessage | null
}

const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

/** Waits until the person stops typing before the value is used. */
export const useDebouncedValue = <T>(value: T, ms = 500): T => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export const useDraftRfiWithAi = (projectId: string) =>
  useMutation({
    mutationFn: (payload: {
      prompt: string
      specSection?: string | null
      discipline?: string | null
      activityId?: string | null
      locationId?: string | null
    }) =>
      data<RfiDraftResult>(
        apiClient.post(`/projects/${projectId}/rfi/ai/draft`, payload, {
          timeout: 120_000,
        })
      ),
  })

export const useSimilarRfis = (
  projectId: string,
  q: string,
  options: { excludeRfiId?: string | null; enabled?: boolean } = {}
) =>
  useQuery<{ query: string; items: SimilarRfi[] }>({
    queryKey: ['rfi-similar', projectId, q.trim(), options.excludeRfiId ?? ''],
    queryFn: () =>
      data<{ query: string; items: SimilarRfi[] }>(
        apiClient.get(`/projects/${projectId}/rfi/ai/similar`, {
          params: {
            q: q.trim(),
            limit: 5,
            excludeRfiId: options.excludeRfiId || undefined,
          },
        })
      ),
    enabled:
      Boolean(projectId) && q.trim().length >= 6 && options.enabled !== false,
    staleTime: 60_000,
  })

export const useSuggestRfiResponse = (projectId: string) =>
  useMutation({
    mutationFn: ({
      rfiId,
      instructions,
    }: {
      rfiId: string
      instructions?: string | null
    }) =>
      data<RfiSuggestionResult>(
        apiClient.post(
          `/projects/${projectId}/rfi/${rfiId}/ai/response`,
          { instructions: instructions || null },
          { timeout: 120_000 }
        )
      ),
  })

export const useSummarizeRfi = (projectId: string) =>
  useMutation({
    mutationFn: ({ rfiId }: { rfiId: string }) =>
      data<RfiSummaryResult>(
        apiClient.post(
          `/projects/${projectId}/rfi/${rfiId}/ai/summary`,
          {},
          { timeout: 120_000 }
        )
      ),
  })
