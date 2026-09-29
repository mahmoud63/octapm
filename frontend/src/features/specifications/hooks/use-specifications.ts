import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Specifications and scope intelligence (OCTA-AI-SPEC-036): the section
 * index of the specification documents, what each section relates to,
 * scope gaps against BOQ / drawings / schedule and the spec-vs-drawing
 * conflict check. Draft-then-approve: an RFI is raised only on request.
 */

export type SpecLevel = 'low' | 'medium' | 'high'
export type SpecBasis =
  | 'code'
  | 'title'
  | 'division'
  | 'discipline'
  | 'spec_section'
export type SpecGap = 'no_boq' | 'no_drawings' | 'no_activities'

export interface SpecDocument {
  id: string
  title: string
  originalName: string
  documentNumber: string | null
  category: string | null
  discipline: string | null
  mimeType: string
  uploadedAt: string | null
  wordCount: number
  pageCount: number | null
  sections: number
  indexedAt: string | null
  likelySpec: boolean
}

export interface SpecSection {
  id: string
  documentId: string
  document?: { id: string; title: string }
  code: string
  codeKey: string
  division: string | null
  divisionLabel: string | null
  title: string
  pageFrom: number | null
  pageTo: number | null
  wordCount: number
  sortOrder: number
  path: string
}

/**
 * The server's reason for leaving the BOQ side of the specification check
 * out — for a member who may not read the BOQ (boq-figures.js, §12).
 */
export interface SpecBoqWithheld {
  reason: string
}

export interface SpecRelated {
  /** Absent for a member who may not read the BOQ; boqItemsWithheld says why. */
  boqItems?: Array<{
    id: string
    code: string | null
    description: string
    unit: string | null
    qty: number
    basis: SpecBasis
    score: number
  }>
  sheets: Array<{
    id: string
    number: string
    title: string
    discipline: string | null
    currentRevisionId: string | null
    basis: SpecBasis
    score: number
    path: string
  }>
  activities: Array<{
    id: string
    name: string
    activityCode: string | null
    wbsCode: string | null
    basis: SpecBasis
    score: number
  }>
  rfis: Array<{
    id: string
    ref: string
    subject: string
    status: string
    basis: SpecBasis
    score: number
    path: string
  }>
  keywords: string[]
  disciplines: string[]
  boqItemsWithheld?: SpecBoqWithheld
}

export interface SpecSectionDetail extends SpecSection {
  text: string
  truncated: boolean
  totalChars: number
  related: SpecRelated
}

export interface SpecScopeGaps {
  sections: Array<
    SpecSection & {
      counts: {
        /** Absent when boqWithheld. */
        boq?: number
        sheets: number
        sheetsByDiscipline: number
        activities: number
        rfis: number
      }
      gaps: SpecGap[]
      keywords: string[]
    }
  >
  summary: {
    sections: number
    withGaps: number
    /** noBoq, boqItems and uncoveredBoq are absent when boqWithheld. */
    noBoq?: number
    noDrawings: number
    noActivities: number
    boqItems?: number
    uncoveredBoq?: number
    sheets: number
    activities: number
  }
  uncoveredBoq?: Array<{
    id: string
    code: string | null
    description: string
    unit: string | null
    qty: number
  }>
  uncoveredDisciplines: Array<{ discipline: string; sheets: number }>
  notes: string[]
  computedAt: string
  /** The BOQ side withheld by the server, and why. */
  boqWithheld?: SpecBoqWithheld
}

export interface AiRunMessage {
  id: string
  provider: string | null
  model: string | null
  feedback: 'up' | 'down' | null
}

export interface SpecGapReview {
  degraded: boolean
  reason?: string | null
  gaps: SpecScopeGaps
  review: {
    headline: string
    narrative: string
    actions: Array<
      | { type: 'create_task'; title: string; description: string | null }
      | { type: 'create_rfi'; subject: string; question: string | null }
    >
  }
  message: AiRunMessage | null
}

export interface SpecConflictResult {
  degraded: boolean
  reason?: string | null
  section: { id: string; code: string; title: string }
  sheetsChecked: Array<{
    id: string
    number: string
    title: string
    revision: string | null
    basis: SpecBasis
    chars: number
  }>
  related: SpecRelated
  result: {
    summary: string
    conflicts: Array<{
      topic: string
      specSays: string | null
      drawingSays: string | null
      sheetNumber: string | null
      severity: SpecLevel
      recommendation: string | null
    }>
    gaps: Array<{
      topic: string
      detail: string | null
      where: 'specification' | 'drawings'
    }>
    confidence: SpecLevel
  } | null
  message: AiRunMessage | null
}

export interface SpecStatus {
  enabled: boolean
  provider: string | null
  model: string | null
  sectionChars: number
  sheetLimit: number
}

const base = (projectId: string) => `/projects/${projectId}/specifications`
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

export const specificationKeys = {
  all: (projectId: string) => ['specifications', projectId] as const,
  status: (projectId: string) =>
    ['specifications', projectId, 'status'] as const,
  documents: (projectId: string) =>
    ['specifications', projectId, 'documents'] as const,
  sections: (projectId: string, q: string, division: string | null) =>
    ['specifications', projectId, 'sections', q, division] as const,
  section: (projectId: string, sectionId: string) =>
    ['specifications', projectId, 'section', sectionId] as const,
  gaps: (projectId: string) => ['specifications', projectId, 'gaps'] as const,
}

export const useSpecStatus = (projectId: string) =>
  useQuery<SpecStatus>({
    queryKey: specificationKeys.status(projectId),
    queryFn: () => data<SpecStatus>(apiClient.get(`${base(projectId)}/status`)),
    staleTime: 5 * 60_000,
    enabled: Boolean(projectId),
  })

export const useSpecDocuments = (projectId: string) =>
  useQuery<{ items: SpecDocument[] }>({
    queryKey: specificationKeys.documents(projectId),
    queryFn: () =>
      data<{ items: SpecDocument[] }>(
        apiClient.get(`${base(projectId)}/documents`)
      ),
    enabled: Boolean(projectId),
  })

export const useIndexSpecifications = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (documentIds: string[] | null) =>
      data<{
        documents: Array<{
          documentId: string
          title: string | null
          sections: number
          dropped: number
          divisions: string[]
          error: string | null
        }>
        sections: number
      }>(
        apiClient.post(
          `${base(projectId)}/index`,
          documentIds ? { documentIds } : {},
          { timeout: 300_000 }
        )
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: specificationKeys.all(projectId) }),
  })
}

export const useSpecSections = (
  projectId: string,
  q: string,
  division: string | null
) =>
  useQuery<{
    items: SpecSection[]
    divisions: Array<{
      division: string | null
      label: string | null
      count: number
    }>
    total: number
  }>({
    queryKey: specificationKeys.sections(projectId, q.trim(), division),
    queryFn: () =>
      data(
        apiClient.get(base(projectId), {
          params: {
            q: q.trim() || undefined,
            division: division || undefined,
          },
        })
      ),
    enabled: Boolean(projectId),
    placeholderData: (previous) => previous,
  })

export const useSpecSection = (projectId: string, sectionId: string | null) =>
  useQuery<SpecSectionDetail>({
    queryKey: specificationKeys.section(projectId, sectionId ?? ''),
    queryFn: () =>
      data<SpecSectionDetail>(apiClient.get(`${base(projectId)}/${sectionId}`)),
    enabled: Boolean(projectId && sectionId),
  })

export const useScopeGaps = (projectId: string, enabled = true) =>
  useQuery<SpecScopeGaps>({
    queryKey: specificationKeys.gaps(projectId),
    queryFn: () =>
      data<SpecScopeGaps>(apiClient.get(`${base(projectId)}/scope-gaps`)),
    enabled: Boolean(projectId) && enabled,
    staleTime: 60_000,
  })

export const useExplainScopeGaps = (projectId: string) =>
  useMutation({
    mutationFn: () =>
      data<SpecGapReview>(
        apiClient.post(
          `${base(projectId)}/scope-gaps/explain`,
          {},
          { timeout: 180_000 }
        )
      ),
  })

export const useCheckSpecConflicts = (projectId: string) =>
  useMutation({
    mutationFn: ({
      sectionId,
      sheetIds,
    }: {
      sectionId: string
      sheetIds?: string[]
    }) =>
      data<SpecConflictResult>(
        apiClient.post(
          `${base(projectId)}/${sectionId}/conflicts`,
          sheetIds?.length ? { sheetIds } : {},
          { timeout: 300_000 }
        )
      ),
  })

export const useRaiseSpecRfi = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      sectionId,
      ...payload
    }: {
      sectionId: string
      subject: string
      question?: string | null
      discipline?: string | null
      priority?: 'low' | 'normal' | 'high' | 'urgent'
    }) =>
      data<{
        record: { id: string; ref: string; status: string }
        url: string
      }>(apiClient.post(`${base(projectId)}/${sectionId}/rfi`, payload)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rfi', projectId] })
      qc.invalidateQueries({ queryKey: ['rfis', projectId] })
    },
  })
}
