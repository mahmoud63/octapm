import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export type DrawingSetStatus =
  | 'draft'
  | 'processing'
  | 'review'
  | 'published'
  | 'archived'
  | 'failed'
export type SheetRevisionStatus =
  | 'pending_review'
  | 'published'
  | 'superseded'
  | 'rejected'
export type SheetStatus = 'current' | 'obsolete'

export const SET_PURPOSES = [
  'IFC',
  'IFT',
  'IFA',
  'AS_BUILT',
  'TENDER',
  'SHOP',
  'RECORD',
  'OTHER',
] as const

export interface FieldConfidence {
  confidence: number
  source: string | null
}

export interface SheetRevision {
  id: string
  projectId: string
  sheetId: string | null
  setId: string | null
  documentId: string
  pageNumber: number
  number: string | null
  title: string | null
  revision: string | null
  discipline: string | null
  status: SheetRevisionStatus
  detected: {
    number: string | null
    title: string | null
    revision: string | null
    discipline: string | null
  }
  confidence: number
  fields: {
    number?: FieldConfidence
    title?: FieldConfidence
    revision?: FieldConfidence
    discipline?: FieldConfidence
  } | null
  textStatus: 'none' | 'ready' | 'no_text'
  width: number | null
  height: number | null
  rotation: number
  reviewedBy: string | null
  reviewedAt: string | null
  publishedBy: string | null
  publishedAt: string | null
  supersededById: string | null
  supersededAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  fileUrl: string | null
  fileName: string | null
  sizeBytes: number | null
  path: string | null
}

export interface Sheet {
  id: string
  projectId: string
  number: string
  title: string
  discipline: string | null
  locationId: string | null
  location: {
    id: string
    name: string
    code: string | null
    path: string
  } | null
  status: SheetStatus
  obsoleteReason: string | null
  currentRevisionId: string | null
  currentRevision: SheetRevision | null
  revisionCount?: number
  revisions?: SheetRevision[]
  drawingRecordId: string | null
  hasFile: boolean
  path: string | null
  createdAt: string
  updatedAt: string
}

export interface DrawingSetCounts {
  total: number
  pending: number
  published: number
  superseded: number
  rejected: number
}

export interface DrawingSet {
  id: string
  projectId: string
  setNumber: string
  name: string
  description: string | null
  discipline: string | null
  purpose: string | null
  status: DrawingSetStatus
  sourceDocumentId: string | null
  fileUrl: string | null
  fileName: string | null
  sizeBytes: number | null
  pageCount: number | null
  processedPages: number
  progress: number
  detectionSummary: {
    pages: number
    detected: number
    needsReview: number
    noText: number
    kept: number
  } | null
  counts: DrawingSetCounts | null
  receivedAt: string | null
  issuedAt: string | null
  uploadedBy: string | null
  publishedAt: string | null
  publishedBy: string | null
  jobId: string | null
  error: string | null
  path: string | null
  revisions?: SheetRevision[]
  createdAt: string
  updatedAt: string
}

export interface SheetFilters {
  discipline?: string | null
  locationId?: string | null
  search?: string
  status?: 'current' | 'obsolete' | 'all'
  setId?: string | null
}

export interface SheetListResponse {
  items: Sheet[]
  summary: {
    total: number
    current: number
    obsolete: number
    disciplines: Array<{ discipline: string; count: number }>
  }
}

export interface PublishResult {
  sheetId: string
  number: string
  title: string
  revisionId: string
  revision: string
  supersededRevisionId: string | null
  isNewSheet: boolean
}

export interface PublishSetResponse {
  published: number
  skipped: number
  remaining: number
  results: PublishResult[]
  set: DrawingSet
}

export interface OfflineManifest {
  generatedAt: string
  items: Array<{
    sheetId: string
    number: string
    title: string
    discipline: string | null
    revisionId: string
    revision: string | null
    documentId: string
    pageNumber: number
    fileUrl: string
    fileName: string | null
    sizeBytes: number | null
    sha256: string | null
    publishedAt: string | null
  }>
  totals: { sheets: number; documents: number; bytes: number }
}

export interface RevisionReviewUpdate {
  id: string
  number?: string | null
  title?: string | null
  revision?: string | null
  discipline?: string | null
  status?: 'pending_review' | 'rejected'
}

/** Keys keep projectId at index 1 so realtime invalidation reaches them. */
export const drawingKeys = {
  sets: (projectId: string) => ['drawing-sets', projectId] as const,
  set: (projectId: string, setId: string) =>
    ['drawing-set', projectId, setId] as const,
  sheets: (projectId: string, filters: SheetFilters = {}) =>
    ['sheets', projectId, filters] as const,
  sheet: (projectId: string, sheetId: string) =>
    ['sheet', projectId, sheetId] as const,
  manifest: (projectId: string) => ['sheet-manifest', projectId] as const,
}

const invalidateDrawings = (
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  queryClient.invalidateQueries({ queryKey: ['drawing-sets', projectId] })
  queryClient.invalidateQueries({ queryKey: ['drawing-set', projectId] })
  queryClient.invalidateQueries({ queryKey: ['sheets', projectId] })
  queryClient.invalidateQueries({ queryKey: ['sheet', projectId] })
  queryClient.invalidateQueries({ queryKey: ['sheet-manifest', projectId] })
  queryClient.invalidateQueries({ queryKey: ['audit-events', projectId] })
}

export const useDrawingSets = (
  projectId: string,
  options: { status?: string; enabled?: boolean } = {}
) =>
  useQuery<{ items: DrawingSet[] }>({
    queryKey: [...drawingKeys.sets(projectId), options.status ?? null],
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: { items: DrawingSet[] } }>(
        `/projects/${projectId}/drawings/sets`,
        { params: { status: options.status || undefined } }
      )
      return data.data
    },
    enabled: (options.enabled ?? true) && Boolean(projectId),
    refetchInterval: (query) =>
      query.state.data?.items.some((set) => set.status === 'processing')
        ? 3000
        : false,
  })

export const useDrawingSet = (
  projectId: string,
  setId: string | null,
  options: { enabled?: boolean } = {}
) =>
  useQuery<DrawingSet>({
    queryKey: drawingKeys.set(projectId, setId || ''),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: DrawingSet }>(
        `/projects/${projectId}/drawings/sets/${setId}`
      )
      return data.data
    },
    enabled: (options.enabled ?? true) && Boolean(projectId && setId),
    refetchInterval: (query) =>
      query.state.data?.status === 'processing' ? 2500 : false,
  })

export interface UploadSetInput {
  file: File
  name?: string
  description?: string
  discipline?: string
  purpose?: string
  receivedAt?: string
  issuedAt?: string
  onProgress?: (percent: number) => void
}

export const useUploadDrawingSet = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UploadSetInput) => {
      const form = new FormData()
      form.append('file', input.file)
      if (input.name) form.append('name', input.name)
      if (input.description) form.append('description', input.description)
      if (input.discipline) form.append('discipline', input.discipline)
      if (input.purpose) form.append('purpose', input.purpose)
      if (input.receivedAt) form.append('receivedAt', input.receivedAt)
      if (input.issuedAt) form.append('issuedAt', input.issuedAt)
      const { data } = await apiClient.post<{ data: DrawingSet }>(
        `/projects/${projectId}/drawings/sets`,
        form,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 10 * 60 * 1000,
          onUploadProgress: (event) => {
            if (input.onProgress && event.total) {
              input.onProgress(Math.round((event.loaded / event.total) * 100))
            }
          },
        }
      )
      return data.data
    },
    onSuccess: () => invalidateDrawings(queryClient, projectId),
  })
}

export const useUpdateDrawingSet = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      setId,
      ...payload
    }: {
      setId: string
      name?: string
      description?: string | null
      discipline?: string | null
      purpose?: string | null
      status?: 'archived' | 'review' | 'published'
    }) => {
      const { data } = await apiClient.patch<{ data: DrawingSet }>(
        `/projects/${projectId}/drawings/sets/${setId}`,
        payload
      )
      return data.data
    },
    onSuccess: () => invalidateDrawings(queryClient, projectId),
  })
}

export const useDeleteDrawingSet = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (setId: string) => {
      const { data } = await apiClient.delete<{
        data: { deleted: boolean; id: string }
      }>(`/projects/${projectId}/drawings/sets/${setId}`)
      return data.data
    },
    onSuccess: () => invalidateDrawings(queryClient, projectId),
  })
}

export const useReprocessDrawingSet = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (setId: string) => {
      const { data } = await apiClient.post<{
        data: { queued: boolean; jobId: string; setId: string }
      }>(`/projects/${projectId}/drawings/sets/${setId}/reprocess`)
      return data.data
    },
    onSuccess: () => invalidateDrawings(queryClient, projectId),
  })
}

export const useReviewRevisions = (projectId: string, setId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (updates: RevisionReviewUpdate[]) => {
      const { data } = await apiClient.patch<{
        data: { items: SheetRevision[] }
      }>(`/projects/${projectId}/drawings/sets/${setId}/revisions`, { updates })
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: drawingKeys.set(projectId, setId),
      })
    },
  })
}

export const usePublishDrawingSet = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      setId,
      revisionIds,
    }: {
      setId: string
      revisionIds?: string[]
    }) => {
      const { data } = await apiClient.post<{ data: PublishSetResponse }>(
        `/projects/${projectId}/drawings/sets/${setId}/publish`,
        revisionIds?.length ? { revisionIds } : {}
      )
      return data.data
    },
    onSuccess: () => invalidateDrawings(queryClient, projectId),
  })
}

export const useSheets = (
  projectId: string,
  filters: SheetFilters = {},
  options: { enabled?: boolean } = {}
) =>
  useQuery<SheetListResponse>({
    queryKey: drawingKeys.sheets(projectId, filters),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: SheetListResponse }>(
        `/projects/${projectId}/drawings/sheets`,
        {
          params: {
            discipline: filters.discipline || undefined,
            locationId: filters.locationId || undefined,
            search: filters.search || undefined,
            status: filters.status || undefined,
            setId: filters.setId || undefined,
          },
        }
      )
      return data.data
    },
    enabled: (options.enabled ?? true) && Boolean(projectId),
    placeholderData: (previous) => previous,
  })

export const useSheet = (
  projectId: string,
  sheetId: string | null,
  options: { enabled?: boolean } = {}
) =>
  useQuery<Sheet>({
    queryKey: drawingKeys.sheet(projectId, sheetId || ''),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: Sheet }>(
        `/projects/${projectId}/drawings/sheets/${sheetId}`
      )
      return data.data
    },
    enabled: (options.enabled ?? true) && Boolean(projectId && sheetId),
  })

export const useUpdateSheet = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      sheetId,
      ...payload
    }: {
      sheetId: string
      title?: string
      discipline?: string | null
      locationId?: string | null
      status?: SheetStatus
      obsoleteReason?: string | null
    }) => {
      const { data } = await apiClient.patch<{ data: Sheet }>(
        `/projects/${projectId}/drawings/sheets/${sheetId}`,
        payload
      )
      return data.data
    },
    onSuccess: () => invalidateDrawings(queryClient, projectId),
  })
}

export const useUploadSheetRevision = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      sheetId,
      file,
      revision,
      title,
      publish,
      onProgress,
    }: {
      sheetId: string
      file: File
      revision: string
      title?: string
      publish?: boolean
      onProgress?: (percent: number) => void
    }) => {
      const form = new FormData()
      form.append('file', file)
      form.append('revision', revision)
      if (title) form.append('title', title)
      if (publish) form.append('publish', 'true')
      const { data } = await apiClient.post<{
        data: { revision: SheetRevision; published: PublishResult | null }
      }>(`/projects/${projectId}/drawings/sheets/${sheetId}/revisions`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 5 * 60 * 1000,
        onUploadProgress: (event) => {
          if (onProgress && event.total) {
            onProgress(Math.round((event.loaded / event.total) * 100))
          }
        },
      })
      return data.data
    },
    onSuccess: () => invalidateDrawings(queryClient, projectId),
  })
}

export const usePublishSheetRevision = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (revisionId: string) => {
      const { data } = await apiClient.post<{
        data: PublishResult & { revision: SheetRevision }
      }>(
        `/projects/${projectId}/drawings/sheets/revisions/${revisionId}/publish`
      )
      return data.data
    },
    onSuccess: () => invalidateDrawings(queryClient, projectId),
  })
}

export const useOfflineManifest = (
  projectId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery<OfflineManifest>({
    queryKey: drawingKeys.manifest(projectId),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: OfflineManifest }>(
        `/projects/${projectId}/drawings/sheets/offline-manifest`
      )
      return data.data
    },
    enabled: (options.enabled ?? true) && Boolean(projectId),
  })

export const formatBytes = (value?: number | null) => {
  if (!value) return '0 KB'
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
