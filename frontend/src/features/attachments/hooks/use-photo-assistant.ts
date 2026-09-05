import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Photo and safety intelligence (OCTA-AI-PHOTO-034): a photo's proposed
 * caption, tags, quality notes and safety findings; applied or raised only
 * when the person says so.
 */

export type PhotoAiLevel = 'low' | 'medium' | 'high'

export interface PhotoAiAnalysis {
  caption: string | null
  tags: string[]
  scene: string | null
  activity: string | null
  locationHint: string | null
  quality: Array<{ text: string; severity: PhotoAiLevel }>
  safety: Array<{
    hazard: string
    description: string | null
    severity: PhotoAiLevel
    confidence: PhotoAiLevel
  }>
  confidence: PhotoAiLevel
}

export interface PhotoAiResult {
  degraded: boolean
  reason?: string | null
  cached: boolean
  photo: {
    id: string
    documentId: string
    caption: string | null
    tags: string[]
    takenAt: string | null
    locationId: string | null
    locationName: string | null
    url: string
    thumbnailUrl: string
  } | null
  analysis: PhotoAiAnalysis | null
  analyzedAt: string | null
  message: {
    id: string
    provider: string | null
    model: string | null
    feedback: 'up' | 'down' | null
  } | null
}

export interface PhotoAiStatus {
  enabled: boolean
  provider: string | null
  model: string | null
  autoOnUpload: boolean
  batchLimit: number
}

export interface PhotoAiBatchResult {
  items: Array<PhotoAiResult & { photoId: string }>
  analyzed: number
  cached: number
  safetyFindings: number
  limit: number
}

const base = (projectId: string) => `/projects/${projectId}/photos`
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)
const key = (projectId: string, photoId: string) =>
  ['photo-ai', projectId, photoId] as const

export const usePhotoAiStatus = (projectId: string, enabled = true) =>
  useQuery<PhotoAiStatus>({
    queryKey: ['photo-ai', projectId, 'status'],
    queryFn: () =>
      data<PhotoAiStatus>(apiClient.get(`${base(projectId)}/ai/status`)),
    staleTime: 5 * 60_000,
    enabled: Boolean(projectId) && enabled,
  })

export const usePhotoAnalysis = (projectId: string, photoId: string | null) =>
  useQuery<PhotoAiResult>({
    queryKey: key(projectId, photoId ?? ''),
    queryFn: () =>
      data<PhotoAiResult>(apiClient.get(`${base(projectId)}/${photoId}/ai`)),
    enabled: Boolean(projectId && photoId),
  })

export const useAnalyzePhoto = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ photoId, force }: { photoId: string; force?: boolean }) =>
      data<PhotoAiResult>(
        apiClient.post(
          `${base(projectId)}/${photoId}/ai/analyze`,
          { force: Boolean(force) },
          { timeout: 120_000 }
        )
      ),
    onSuccess: (_result, variables) =>
      qc.invalidateQueries({ queryKey: key(projectId, variables.photoId) }),
  })
}

export const useAnalyzePhotos = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      photoIds?: string[]
      from?: string | null
      to?: string | null
      uncaptionedOnly?: boolean
      force?: boolean
      limit?: number
    }) =>
      data<PhotoAiBatchResult>(
        apiClient.post(`${base(projectId)}/ai/analyze`, payload, {
          timeout: 300_000,
        })
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['photo-ai', projectId] }),
  })
}

export const useApplyPhotoAnalysis = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      photoId,
      ...payload
    }: {
      photoId: string
      caption?: string | null
      tags?: string[]
      locationId?: string | null
      overwrite?: boolean
    }) =>
      data<{ applied: Record<string, boolean> }>(
        apiClient.post(`${base(projectId)}/${photoId}/ai/apply`, payload)
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['photos', projectId] })
      qc.invalidateQueries({ queryKey: ['attachments', projectId] })
    },
  })
}

export const useRaisePhotoObservation = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      photoId,
      ...payload
    }: {
      photoId: string
      hazard: string
      description?: string | null
      severity?: PhotoAiLevel | null
      trade?: string | null
    }) =>
      data<{
        item: { id: string; ref: string; kind: string; status: string }
        attached: boolean
        url: string
      }>(
        apiClient.post(`${base(projectId)}/${photoId}/ai/observation`, payload)
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['punch', projectId] })
      qc.invalidateQueries({ queryKey: ['photos', projectId] })
    },
  })
}
