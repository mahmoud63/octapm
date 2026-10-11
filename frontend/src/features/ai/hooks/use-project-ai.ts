import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Project-level AI (AI-3): `/projects/{id}/ai/attention` and `/ai/summary`.
 * The facts and the attention list are the caller's own dashboard figures;
 * the narrative is the model's interpretation of them, requested on demand.
 */

export type BriefKind = 'attention' | 'summary'

export interface BriefFact {
  key: string
  label: string
  value: string
  rule?: string
}

export interface BriefItem {
  id: string
  type: string
  typeLabel: string
  title: string
  ref: string | null
  status: string | null
  severity: string
  dueDate: string | null
  snippet: string | null
  projectId: string
  projectName: string | null
  url: string | null
  why: string | null
}

export interface BriefCitation {
  n: number
  id: string
  type: string
  typeLabel: string
  title: string
  ref: string | null
  url: string | null
}

export interface ProjectBrief {
  kind: BriefKind
  project: { id: string; name: string | null; status?: string; currency?: string | null }
  cutoffDate: string
  generatedAt: string
  facts: BriefFact[]
  items: BriefItem[]
  narrative: {
    text: string
    citations: BriefCitation[]
    provider: string | null
    model: string | null
    mock: boolean
    label: string
  } | null
  ai: { enabled: boolean; mode: 'mock' | 'live' | 'disabled' }
  degraded: boolean
  degradedReason: string | null
}

const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

/** Facts and the attention list only: no model call, so it loads on every visit. */
export const useProjectBrief = (projectId: string, enabled = true) =>
  useQuery<ProjectBrief>({
    queryKey: ['project-ai', projectId, 'brief'],
    queryFn: () =>
      data<ProjectBrief>(
        apiClient.get(`/projects/${projectId}/ai/attention`, {
          params: { narrative: false },
        })
      ),
    staleTime: 60_000,
    enabled,
  })

export interface ProjectStatusReport {
  title: string
  project: ProjectBrief['project']
  cutoffDate: string
  generatedAt: string
  facts: BriefFact[]
  attention: BriefItem[]
  sources: Array<BriefCitation & { projectName?: string | null }>
  interpretation: { text: string; citations: BriefCitation[] } | null
  recommendations: Array<{ text: string; citations: BriefCitation[] }>
  ai: { enabled: boolean; mode: 'mock' | 'live' | 'disabled'; provider: string | null; model: string | null }
  degraded: boolean
  degradedReason: string | null
}

/** The AI status report (AI-5): FACT, AI INTERPRETATION and AI RECOMMENDATION. */
export const useProjectStatusReport = (projectId: string) =>
  useMutation({
    mutationFn: () =>
      data<ProjectStatusReport>(
        apiClient.get(`/projects/${projectId}/ai/report`, { timeout: 120_000 })
      ),
  })

/** The model's brief over the same facts, when the reader asks for it. */
export const useExplainProject = (projectId: string) =>
  useMutation({
    mutationFn: (kind: BriefKind) =>
      data<ProjectBrief>(
        apiClient.get(`/projects/${projectId}/ai/${kind}`, { timeout: 120_000 })
      ),
  })
