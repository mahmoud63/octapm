import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export type AttachmentRole = 'attachment' | 'evidence' | 'photo' | 'reference'

export interface AttachedDocument {
  id: string
  fileName: string
  originalName: string | null
  mimeType: string
  sizeBytes: number
  documentType: string
  uploadedBy: string | null
  uploadedAt: string | null
  url: string
}

export interface PhotoRecord {
  id: string
  documentId: string
  locationId: string | null
  location: {
    id: string
    name: string
    fullName?: string | null
    path: string
  } | null
  caption: string | null
  tags: string[]
  takenAt: string | null
  latitude: number | null
  longitude: number | null
  altitude: number | null
  cameraMake: string | null
  cameraModel: string | null
  width: number | null
  height: number | null
  orientation: number | null
  thumbnailStatus: 'pending' | 'ready' | 'unavailable' | 'failed'
  url: string
  thumbnailUrl: string
  uploadedBy: string | null
  createdAt: string | null
  updatedAt: string | null
  document?: AttachedDocument | null
  records?: Array<{ recordType: string; recordId: string; role: string }>
}

export interface AttachmentRecord {
  id: string
  projectId: string
  recordType: string
  recordId: string
  documentId: string
  role: AttachmentRole
  caption: string | null
  sortOrder: number
  source: string
  uploadedBy: string | null
  createdAt: string | null
  document: AttachedDocument | null
  photo: PhotoRecord | null
  fileName: string | null
  fileUrl: string | null
  mimeType: string | null
  sizeBytes: number | null
}

export interface PhotoFilters {
  from?: string
  to?: string
  locationId?: string | null
  tag?: string
  recordType?: string
  recordId?: string
  search?: string
  limit?: number
}

export const attachmentKeys = {
  record: (projectId: string, recordType: string, recordId: string) =>
    ['attachments', projectId, recordType, recordId] as const,
  photos: (projectId: string, filters: PhotoFilters = {}) =>
    ['photos', projectId, filters] as const,
}

export const useAttachments = (
  projectId: string,
  recordType: string,
  recordId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: attachmentKeys.record(projectId, recordType, recordId),
    queryFn: async () => {
      const { data } = await apiClient.get<{
        data: { items: AttachmentRecord[] }
      }>(`/projects/${projectId}/attachments`, {
        params: { recordType, recordId },
      })
      return data.data
    },
    enabled:
      Boolean(projectId && recordType && recordId) && (options.enabled ?? true),
  })

const invalidateAttachments = (
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  queryClient.invalidateQueries({ queryKey: ['attachments', projectId] })
  queryClient.invalidateQueries({ queryKey: ['photos', projectId] })
  queryClient.invalidateQueries({ queryKey: ['audit-events', projectId] })
}

export interface UploadAttachmentsInput {
  recordType: string
  recordId: string
  files?: File[]
  documentIds?: string[]
  role?: AttachmentRole
  caption?: string
  locationId?: string | null
  tags?: string[]
}

export const useUploadAttachments = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UploadAttachmentsInput) => {
      const form = new FormData()
      form.append('recordType', input.recordType)
      form.append('recordId', input.recordId)
      if (input.role) form.append('role', input.role)
      if (input.caption) form.append('caption', input.caption)
      if (input.locationId) form.append('locationId', input.locationId)
      if (input.tags?.length) form.append('tags', input.tags.join(','))
      if (input.documentIds?.length) {
        form.append('documentIds', JSON.stringify(input.documentIds))
      }
      for (const file of input.files ?? []) form.append('files', file)
      const { data } = await apiClient.post<{
        data: { items: AttachmentRecord[] }
      }>(`/projects/${projectId}/attachments`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return data.data
    },
    onSuccess: (_result, input) => {
      invalidateAttachments(queryClient, projectId)
      // Record lists embed attachments, so refresh the module too.
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey[1] === projectId,
      })
      void input
    },
  })
}

export const useDeleteAttachment = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (attachmentId: string) => {
      const { data } = await apiClient.delete<{ data: { deleted: boolean } }>(
        `/projects/${projectId}/attachments/${attachmentId}`
      )
      return data.data
    },
    onSuccess: () => {
      invalidateAttachments(queryClient, projectId)
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey[1] === projectId,
      })
    },
  })
}

export const usePhotos = (
  projectId: string,
  filters: PhotoFilters = {},
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: attachmentKeys.photos(projectId, filters),
    queryFn: async () => {
      const params: Record<string, string | number> = {}
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null && value !== '') {
          params[key] = value as string | number
        }
      }
      const { data } = await apiClient.get<{
        data: {
          items: PhotoRecord[]
          pagination: { limit: number; nextCursor: string | null }
          summary: {
            total: number
            tags: Array<{ tag: string; count: number }>
          }
        }
      }>(`/projects/${projectId}/photos`, { params })
      return data.data
    },
    enabled: Boolean(projectId) && (options.enabled ?? true),
  })

export const useUpdatePhoto = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      photoId,
      payload,
    }: {
      photoId: string
      payload: {
        caption?: string | null
        tags?: string[]
        locationId?: string | null
        takenAt?: string | null
      }
    }) => {
      const { data } = await apiClient.patch<{ data: PhotoRecord }>(
        `/projects/${projectId}/photos/${photoId}`,
        payload
      )
      return data.data
    },
    onSuccess: () => invalidateAttachments(queryClient, projectId),
  })
}

export const formatBytes = (value: number | null | undefined) => {
  if (!value && value !== 0) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
