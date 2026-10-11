import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/** Document Q&A (AI-6): `/projects/{id}/ai/documents/ask`. */

export interface DocumentPassage {
  n: number
  documentId: string
  title: string
  ref: string | null
  chunkIndex: number
  charStart: number
  charEnd: number
  snippet: string
  url: string
}

export interface DocumentAnswer {
  question: string
  documents: Array<{ id: string; title: string; ref: string | null }>
  notIndexed: Array<{ documentId: string; title: string; status: string }>
  passages: DocumentPassage[]
  answer: {
    text: string
    citations: DocumentPassage[]
    provider: string | null
    model: string | null
    mock: boolean
    label: string
  } | null
  ai: { enabled: boolean; mode: 'mock' | 'live' | 'disabled' }
  degraded: boolean
  degradedReason: string | null
  insufficient: boolean
}

export const useAskDocuments = (projectId: string) =>
  useMutation({
    mutationFn: (payload: {
      question: string
      documentIds?: string[]
      /** summary / compare read the named documents from their start. */
      mode?: 'answer' | 'summary' | 'compare'
    }) =>
      apiClient
        .post(`/projects/${projectId}/ai/documents/ask`, payload, { timeout: 120_000 })
        .then((response) => response.data.data as DocumentAnswer),
  })
