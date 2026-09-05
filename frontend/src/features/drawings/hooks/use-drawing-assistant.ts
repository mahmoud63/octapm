import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { renderSheetPage } from '../lib/pdf'
import type { SheetRevision } from './use-drawings'

/**
 * Drawing intelligence (OCTA-AI-DWG-035): title blocks read from rendered
 * pages, cross-references between sheets and a plain-language revision
 * comparison. Pages are rendered here with PDF.js and sent as JPEG data
 * URLs; nothing is written until the person applies a proposal.
 */

export type DrawingAiLevel = 'low' | 'medium' | 'high'

export interface DrawingAiStatus {
  vision: boolean
  provider: string | null
  model: string | null
  pageLimit: number
}

export interface TitleBlockProposal {
  number: string | null
  title: string | null
  revision: string | null
  date: string | null
  discipline: string | null
  scale: string | null
  drawnBy: string | null
  references: string[]
  fields: Record<'number' | 'title' | 'revision', { confidence: number }>
  notes: string | null
}

export interface TitleBlockReadItem {
  revisionId: string
  pageNumber?: number | null
  current?: {
    number: string | null
    title: string | null
    revision: string | null
    discipline: string | null
    status: string
    textStatus: string
  } | null
  proposal: TitleBlockProposal | null
  error?: string | null
  message?: { id: string; provider: string | null; model: string | null } | null
}

export interface TitleBlockReadResult {
  degraded: boolean
  reason?: string | null
  items: TitleBlockReadItem[]
  applied: number
  limit?: number
}

export interface SheetReferenceSheet {
  id: string
  number: string
  title: string | null
  discipline: string | null
  status: string
  path: string
}

export interface SheetReference {
  id: string
  sheetId: string
  revisionId: string | null
  targetNumber: string
  targetSheet: SheetReferenceSheet | null
  sheet: SheetReferenceSheet | null
  count: number
  samples: string[]
  source: 'text' | 'vision' | 'manual'
  updatedAt: string | null
}

export interface SheetReferences {
  sheetId: string
  outgoing: SheetReference[]
  incoming: SheetReference[]
  builtAt: string | null
  built?: number
  textStatus?: 'ready' | 'no_text' | 'no_revision'
}

export interface RevisionComparison {
  summary: string
  changes: Array<{
    area: string | null
    description: string
    kind: 'added' | 'removed' | 'modified'
    impact: DrawingAiLevel
  }>
  confidence: DrawingAiLevel
}

export interface RevisionCompareResult {
  degraded: boolean
  reason?: string | null
  sheet?: { id: string; number: string; title: string | null } | null
  from?: { id: string; revision: string | null } | null
  to?: { id: string; revision: string | null } | null
  comparison: RevisionComparison | null
  message: {
    id: string
    provider: string | null
    model: string | null
    feedback: 'up' | 'down' | null
  } | null
}

const base = (projectId: string) => `/projects/${projectId}/drawings/ai`
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)
const referencesKey = (projectId: string, sheetId: string) =>
  ['sheet-references', projectId, sheetId] as const

/** The server accepts ~2 MB of image per page. */
const MAX_DATA_URL = 2_700_000

/**
 * Renders a revision's page to a JPEG data URL small enough for the API:
 * the title block needs legible text, so it starts wide and lowers quality,
 * then width, until the payload fits.
 */
export const renderRevisionImage = async (
  revision: Pick<SheetRevision, 'fileUrl' | 'pageNumber' | 'rotation'>,
  width: number,
  signal?: AbortSignal
): Promise<string | null> => {
  if (!revision.fileUrl) return null
  const attempts: Array<[number, number]> = [
    [width, 0.72],
    [width, 0.5],
    [Math.round(width * 0.75), 0.5],
    [Math.round(width * 0.6), 0.4],
  ]
  for (const [attemptWidth, quality] of attempts) {
    const canvas = document.createElement('canvas')
    const rendered = await renderSheetPage({
      fileUrl: revision.fileUrl,
      pageNumber: revision.pageNumber,
      canvas,
      width: attemptWidth,
      rotation: revision.rotation,
      signal,
    })
    if (!rendered) return null
    const url = canvas.toDataURL('image/jpeg', quality)
    if (url.length <= MAX_DATA_URL) return url
  }
  return null
}

export const useDrawingAiStatus = (projectId: string, enabled = true) =>
  useQuery<DrawingAiStatus>({
    queryKey: ['drawing-ai', projectId, 'status'],
    queryFn: () =>
      data<DrawingAiStatus>(apiClient.get(`${base(projectId)}/status`)),
    staleTime: 5 * 60_000,
    enabled: Boolean(projectId) && enabled,
  })

export const useReadTitleBlocks = (projectId: string, setId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      pages: Array<{ revisionId: string; image: string }>
      apply?: boolean
      overwrite?: boolean
    }) =>
      data<TitleBlockReadResult>(
        apiClient.post(`${base(projectId)}/sets/${setId}/read`, payload, {
          timeout: 300_000,
        })
      ),
    onSuccess: (result) => {
      if (result.applied > 0)
        qc.invalidateQueries({ queryKey: ['drawing-sets', projectId] })
    },
  })
}

export const useSheetReferences = (projectId: string, sheetId: string | null) =>
  useQuery<SheetReferences>({
    queryKey: referencesKey(projectId, sheetId ?? ''),
    queryFn: () =>
      data<SheetReferences>(
        apiClient.get(`${base(projectId)}/sheets/${sheetId}/references`)
      ),
    enabled: Boolean(projectId && sheetId),
    staleTime: 60_000,
  })

export const useBuildSheetReferences = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sheetId: string) =>
      data<SheetReferences>(
        apiClient.post(
          `${base(projectId)}/sheets/${sheetId}/references`,
          {},
          {
            timeout: 120_000,
          }
        )
      ),
    onSuccess: (result) => {
      qc.setQueryData(referencesKey(projectId, result.sheetId), result)
      qc.invalidateQueries({ queryKey: ['sheet-references', projectId] })
    },
  })
}

export const useBuildSetReferences = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (setId: string) =>
      data<{
        setId: string
        sheetsBuilt: number
        references: number
        noText: number
        revisions: number
      }>(
        apiClient.post(
          `${base(projectId)}/sets/${setId}/references`,
          {},
          {
            timeout: 300_000,
          }
        )
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['sheet-references', projectId] }),
  })
}

export const useCompareRevisionsWithAi = (projectId: string) =>
  useMutation({
    mutationFn: ({
      sheetId,
      ...payload
    }: {
      sheetId: string
      a: { revisionId: string; image: string }
      b: { revisionId: string; image: string }
    }) =>
      data<RevisionCompareResult>(
        apiClient.post(
          `${base(projectId)}/sheets/${sheetId}/compare`,
          payload,
          {
            timeout: 300_000,
          }
        )
      ),
  })
