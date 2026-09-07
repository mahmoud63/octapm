import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Subcontractor prequalification (OCTA-SUB-PREQUAL-057).
 *
 * `status` is what somebody recorded; `effectiveStatus` is what it means
 * today — a qualification granted on cover that has since lapsed reads as
 * `expired` without the stored record changing.
 */

export const prequalStatuses = [
  'not_assessed',
  'draft',
  'under_review',
  'approved',
  'conditionally_approved',
  'rejected',
  'expired',
] as const
export type PrequalStatus = (typeof prequalStatuses)[number]

export type PrequalDecision =
  | 'approved'
  | 'conditionally_approved'
  | 'rejected'

export interface PrequalState {
  status: PrequalStatus
  qualified: boolean
  score: number | null
  validUntil: string | null
  expiresAt: string | null
  expiresBecause: string | null
  singleAwardLimit: number | null
  conditions: string | null
}

export interface PrequalCriterion {
  id: string
  key: string
  label: string
  category: 'commercial' | 'hse' | 'capability' | 'compliance' | 'quality'
  weight: number
  maxScore: number
  score: number | null
  required: boolean
  tracksExpiry: boolean
  reference: string | null
  expiresAt: string | null
  expired: boolean
  note: string | null
  hint: string | null
  sortOrder: number
}

export interface VendorPrequalification {
  id: string
  companyId: string
  company: { id: string; name: string; trades: string[] } | null
  status: Exclude<PrequalStatus, 'not_assessed' | 'expired'>
  effectiveStatus: PrequalStatus
  qualified: boolean
  score: number | null
  scoredCriteria: number
  weightAssessed: number
  band: string | null
  recommendation: PrequalDecision | null
  storedRecommendation: PrequalDecision | null
  decisionAgainstScore: boolean
  validUntil: string | null
  expiresAt: string | null
  expiresBecause: string | null
  expired: boolean
  singleAwardLimit: number | null
  conditions: string | null
  decisionNote: string | null
  submittedAt: string | null
  decidedAt: string | null
  decidedBy: string | null
  gaps: string[]
  criteria: PrequalCriterion[]
  createdAt: string | null
  updatedAt: string | null
}

export interface PrequalOverviewRow {
  companyId: string
  name: string
  trades: string[]
  status: PrequalStatus
  qualified: boolean
  score: number | null
  validUntil: string | null
  expiresAt: string | null
  expiresBecause: string | null
  expiringSoon: boolean
  singleAwardLimit: number | null
  gaps: string[]
}

export interface PrequalOverview {
  items: PrequalOverviewRow[]
  summary: {
    vendors: number
    qualified: number
    notAssessed: number
    underReview: number
    expired: number
    rejected: number
    expiringSoon: number
  }
}

export const prequalKeys = {
  overview: (withinDays?: number) => ['company-prequalification', withinDays] as const,
  vendor: (companyId: string) => ['company-prequalification', 'vendor', companyId] as const,
}

/** How each state should read on screen. */
export const prequalLabel: Record<PrequalStatus, string> = {
  not_assessed: 'Not assessed',
  draft: 'Draft',
  under_review: 'Under review',
  approved: 'Approved',
  conditionally_approved: 'Conditionally approved',
  rejected: 'Rejected',
  expired: 'Expired',
}

export const usePrequalOverview = (
  withinDays?: number,
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: prequalKeys.overview(withinDays),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: PrequalOverview }>(
        '/company/prequalification',
        { params: withinDays ? { withinDays } : undefined }
      )
      return data.data
    },
    enabled: options.enabled ?? true,
  })

export const useVendorPrequalification = (
  companyId: string | null,
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: prequalKeys.vendor(companyId ?? 'none'),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: VendorPrequalification }>(
        `/company/vendors/${companyId}/prequalification`
      )
      return data.data
    },
    enabled: Boolean(companyId) && (options.enabled ?? true),
  })

const useInvalidate = () => {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['company-prequalification'] })
    queryClient.invalidateQueries({ queryKey: ['company-vendors'] })
  }
}

export const useScoreCriterion = (companyId: string) => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async ({
      key,
      payload,
    }: {
      key: string
      payload: {
        score?: number | null
        note?: string | null
        reference?: string | null
        expiresAt?: string | null
      }
    }) => {
      const { data } = await apiClient.patch<{ data: VendorPrequalification }>(
        `/company/vendors/${companyId}/prequalification/criteria/${key}`,
        payload
      )
      return data.data
    },
    onSuccess: invalidate,
  })
}

export const useDecidePrequalification = (companyId: string) => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (payload: {
      status: PrequalDecision
      validUntil?: string | null
      conditions?: string | null
      decisionNote?: string | null
      singleAwardLimit?: number | null
    }) => {
      const { data } = await apiClient.post<{ data: VendorPrequalification }>(
        `/company/vendors/${companyId}/prequalification/decision`,
        payload
      )
      return data.data
    },
    onSuccess: invalidate,
  })
}

export const useReopenPrequalification = (companyId: string) => {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (reason: string) => {
      const { data } = await apiClient.post<{ data: VendorPrequalification }>(
        `/company/vendors/${companyId}/prequalification/reopen`,
        { reason }
      )
      return data.data
    },
    onSuccess: invalidate,
  })
}
