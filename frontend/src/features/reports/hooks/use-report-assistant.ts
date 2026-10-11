import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { ReportDefinitionInput, ReportResult } from './use-report-builder'

/**
 * Natural-language reporting (OCTA-AI-NLREPORT-033): a question becomes a
 * builder definition (previewed, never saved by the assistant); a preview
 * becomes a plain-language summary.
 */

export interface ReportAskResult {
  degraded: boolean
  reason?: string | null
  question: string
  definition: ReportDefinitionInput
  explanation: string | null
  assumptions: string[]
  warnings: string[]
  preview: ReportResult | null
  message: {
    id: string
    provider: string | null
    model: string | null
    feedback: 'up' | 'down' | null
  } | null
}

export interface ReportNarrativeResult {
  degraded: boolean
  reason?: string | null
  /** The builder's own numbers: never written by a model (AI-5). */
  facts?: { headline: string; items: string[]; caveats: string[] }
  /** "ai" when `narrative` is the model's interpretation, "rules" when it restates the facts. */
  generatedBy?: 'ai' | 'rules'
  recommendations?: string[]
  narrative: {
    headline: string
    summary: string
    highlights: string[]
    caveats: string[]
  }
  result: {
    total: number
    groups: number
    projects: { inScope: number; queried: number; denied: number }
    truncated: boolean
  }
  message: {
    id: string
    provider: string | null
    model: string | null
    feedback: 'up' | 'down' | null
  } | null
}

const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

export const useAskReport = () =>
  useMutation({
    mutationFn: (payload: { question: string; projectId?: string | null }) =>
      data<ReportAskResult>(
        apiClient.post(
          '/reports/ask',
          { question: payload.question, projectId: payload.projectId || null },
          { timeout: 120_000 }
        )
      ),
  })

export const useNarrateReport = () =>
  useMutation({
    mutationFn: (payload: Omit<ReportDefinitionInput, 'name' | 'visibility'>) =>
      data<ReportNarrativeResult>(
        apiClient.post('/reports/narrate', payload, { timeout: 120_000 })
      ),
  })
