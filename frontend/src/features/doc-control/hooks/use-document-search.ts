import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export type DocumentTextStatus = 'pending' | 'ready' | 'unsupported' | 'failed'
export type EmbeddingStatus =
  | 'none'
  | 'pending'
  | 'ready'
  | 'failed'
  | 'disabled'

export interface DocumentTextSummary {
  status: DocumentTextStatus
  extractor: string | null
  wordCount: number
  pageCount: number | null
  embeddingStatus: EmbeddingStatus
}

export interface DocumentSearchHit {
  documentId: string
  projectId: string
  title: string
  fileName: string
  originalName: string | null
  documentNumber: string | null
  mimeType: string
  sizeBytes: number
  documentType: string
  folderPath: string | null
  uploadedAt: string | null
  rank: number
  semanticScore: number | null
  score: number
  /** Matches are wrapped in [[ and ]]. */
  snippet: string | null
  snippetText: string | null
  matchedChunk: string | null
  text: DocumentTextSummary | null
  revision: {
    id: string
    recordType: string
    recordId: string
    revision: string
    status: string | null
    isLatest: boolean
  } | null
  records: Array<{
    recordType: string
    recordId: string
    role: string
    path: string | null
  }>
  path: string | null
  fileUrl: string
}

export interface EmbeddingsInfo {
  enabled: boolean
  provider?: string | null
  model?: string | null
}

export interface DocumentSearchResponse {
  query: string | null
  items: DocumentSearchHit[]
  meta: {
    limit: number
    total: number
    mode: 'text' | 'hybrid'
    embeddings: EmbeddingsInfo
  }
}

export interface DocumentIndexStatus {
  documents: number
  indexed: number
  notIndexed: number
  counts: Record<DocumentTextStatus, number>
  embeddings: EmbeddingsInfo
}

export interface DocumentTextResponse {
  document: DocumentSearchHit
  text: {
    documentId: string
    status: DocumentTextStatus
    extractor: string | null
    excerpt: string | null
    wordCount: number
    pageCount: number | null
    chunkCount: number
    embeddingStatus: EmbeddingStatus
    embeddingModel: string | null
    error: string | null
    extractedAt: string | null
    text: string
    truncated: boolean
    totalChars: number
  } | null
  extractable: boolean
}

/** Keys keep projectId at index 1 so realtime invalidation reaches them. */
export const documentSearchKeys = {
  search: (projectId: string, q: string, semantic: boolean) =>
    ['document-search', projectId, q, semantic] as const,
  status: (projectId: string) => ['document-index-status', projectId] as const,
  text: (projectId: string, documentId: string) =>
    ['document-text', projectId, documentId] as const,
}

export const useDocumentSearch = (
  projectId: string,
  q: string,
  options: { semantic?: boolean; limit?: number; enabled?: boolean } = {}
) => {
  const query = q.trim()
  const semantic = Boolean(options.semantic)
  const limit = options.limit ?? 20
  return useQuery<DocumentSearchResponse>({
    queryKey: [...documentSearchKeys.search(projectId, query, semantic), limit],
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: DocumentSearchResponse }>(
        `/projects/${projectId}/documents/search`,
        {
          params: {
            q: query,
            limit,
            semantic: semantic || undefined,
          },
        }
      )
      return data.data
    },
    enabled:
      (options.enabled ?? true) && Boolean(projectId) && query.length > 0,
    placeholderData: (previous) => previous,
  })
}

export const useDocumentIndexStatus = (
  projectId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery<DocumentIndexStatus>({
    queryKey: documentSearchKeys.status(projectId),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: DocumentIndexStatus }>(
        `/projects/${projectId}/documents/index-status`
      )
      return data.data
    },
    enabled: (options.enabled ?? true) && Boolean(projectId),
    refetchInterval: (query) =>
      (query.state.data?.counts.pending ?? 0) > 0 ? 5000 : false,
  })

export const useReindexDocuments = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { force?: boolean } = {}) => {
      const { data } = await apiClient.post<{
        data: {
          total: number
          queued: number
          skipped: number
          unsupported: number
        }
      }>(`/projects/${projectId}/documents/reindex`, input)
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: documentSearchKeys.status(projectId),
      })
    },
  })
}

export const useDocumentText = (
  projectId: string,
  documentId: string | null,
  options: { maxChars?: number; enabled?: boolean } = {}
) =>
  useQuery<DocumentTextResponse>({
    queryKey: [
      ...documentSearchKeys.text(projectId, documentId || ''),
      options.maxChars ?? null,
    ],
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: DocumentTextResponse }>(
        `/projects/${projectId}/documents/${documentId}/text`,
        { params: { maxChars: options.maxChars } }
      )
      return data.data
    },
    enabled: (options.enabled ?? true) && Boolean(projectId && documentId),
  })

export const useExtractDocument = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (documentId: string) => {
      const { data } = await apiClient.post<{
        data: { queued: boolean; status: string; jobId: string | null }
      }>(`/projects/${projectId}/documents/${documentId}/extract`)
      return data.data
    },
    onSuccess: (_result, documentId) => {
      queryClient.invalidateQueries({
        queryKey: documentSearchKeys.text(projectId, documentId),
      })
      queryClient.invalidateQueries({
        queryKey: documentSearchKeys.status(projectId),
      })
    },
  })
}
