import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { ChangeEventType, RfqStatus } from '../hooks/use-change-events'

/** Vendor quotation portal (no login): everything is scoped by the RFQ token in the URL. */

export interface RfqPortalView {
  rfq: {
    ref: string
    companyName: string
    contactName: string | null
    status: RfqStatus
    dueDate: string | null
    expiresAt: string | null
    instructions: string | null
    acceptingQuotes: boolean
    declinedReason: string | null
  }
  changeEvent: {
    ref: string
    title: string
    description: string | null
    type: ChangeEventType
    projectName: string | null
    currency: string | null
    lines: Array<{
      id: string
      description: string
      quantity: number
      unit: string | null
      activity: string | null
      notes: string | null
    }>
  }
  quote: {
    lines: Array<{ lineId: string; amount: number | null; note: string | null }>
    total: number | null
    notes: string | null
    validUntil: string | null
    leadTimeDays: number | null
    quotedBy: string | null
    quotedAt: string | null
  }
}

export interface RfqQuoteInput {
  lines: Array<{
    lineId: string
    amount: number | string | null
    note?: string | null
  }>
  total?: number | string | null
  notes?: string | null
  validUntil?: string | null
  leadTimeDays?: number | null
  quotedBy?: string | null
}

const base = (token: string) => `/public/rfqs/${encodeURIComponent(token)}`
const key = (token: string) => ['rfq-portal', token] as const
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

export const useRfqPortalView = (token: string) =>
  useQuery<RfqPortalView>({
    queryKey: key(token),
    queryFn: () => data<RfqPortalView>(apiClient.get(base(token))),
    enabled: Boolean(token),
    retry: false,
  })

export const useRfqPortalQuote = (token: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: RfqQuoteInput) =>
      data<RfqPortalView>(apiClient.put(`${base(token)}/quote`, payload)),
    onSuccess: (view) => qc.setQueryData(key(token), view),
  })
}

export const useRfqPortalDecline = (token: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { reason?: string | null }) =>
      data<RfqPortalView>(apiClient.post(`${base(token)}/decline`, payload)),
    onSuccess: (view) => qc.setQueryData(key(token), view),
  })
}
