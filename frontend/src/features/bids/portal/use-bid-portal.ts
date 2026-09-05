import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type {
  BidAddendum,
  BidLine,
  BidQuestion,
  BidRecord,
} from '../hooks/use-bids'

/** Bidder portal (no login): everything is scoped by the invitation token in the URL. */

export interface PortalView {
  invitation: {
    id: string
    companyName: string
    contactName: string | null
    contactEmail: string
    status: string
    expiresAt: string | null
    declinedReason: string | null
  }
  package: {
    ref: string
    title: string
    description: string | null
    instructions: string | null
    status: string
    acceptingBids: boolean
    dueAt: string | null
    questionsDueAt: string | null
    questionsOpen: boolean
    currency: string
    lines: BidLine[]
    addenda: BidAddendum[]
    questions: BidQuestion[]
    documents: Array<{
      id: string
      fileName: string
      mimeType: string
      sizeBytes: number
      caption: string | null
      uploadedAt: string | null
      downloadUrl: string
    }>
    awarded: 'you' | 'other' | null
  }
  bid: BidRecord | null
}

export interface PortalBidInput {
  lines?: Array<{
    packageLineId: string
    rate?: number | string | null
    included?: boolean
    note?: string | null
  }>
  notes?: string | null
  inclusions?: string | null
  exclusions?: string | null
  validityDays?: number | null
  leadTimeDays?: number | null
}

const base = (token: string) => `/public/bids/${encodeURIComponent(token)}`
const key = (token: string) => ['bid-portal', token] as const
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

export const usePortalView = (token: string) =>
  useQuery<PortalView>({
    queryKey: key(token),
    queryFn: () => data<PortalView>(apiClient.get(base(token))),
    enabled: Boolean(token),
    retry: false,
  })

export const usePortalAsk = (token: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { question: string; askedBy?: string | null }) =>
      data<BidQuestion>(apiClient.post(`${base(token)}/questions`, payload)),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(token) }),
  })
}

export const usePortalSaveBid = (token: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: PortalBidInput) =>
      data<BidRecord>(apiClient.put(`${base(token)}/bid`, payload)),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(token) }),
  })
}

export const usePortalBidAction = (token: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      action,
      body,
    }: {
      action: 'bid/submit' | 'bid/withdraw' | 'decline'
      body?: Record<string, unknown>
    }) =>
      data<BidRecord>(apiClient.post(`${base(token)}/${action}`, body ?? {})),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(token) }),
  })
}

export const usePortalUpload = (token: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return data<BidRecord>(
        apiClient.post(`${base(token)}/upload`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120_000,
        })
      )
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key(token) }),
  })
}

export const portalDocumentHref = (downloadUrl: string) => {
  const apiBase = import.meta.env.VITE_API_URL?.replace(/\/$/, '') || '/api/v1'
  return downloadUrl.startsWith('/api/v1')
    ? `${apiBase}${downloadUrl.slice('/api/v1'.length)}`
    : downloadUrl
}
