import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Contract intelligence (OCTA-AI-CONTRACT-032): the contract profile and its
 * clauses, the notice monitor, drafted notices and EOT entitlement
 * assessments. Every model output is a proposal a person confirms.
 */

export type ContractForm =
  | 'fidic_1999'
  | 'fidic_2017'
  | 'nec4'
  | 'jct_2016'
  | 'aia_a201'
  | 'custom'
export type ClauseCategory =
  | 'notice'
  | 'eot'
  | 'variation'
  | 'payment'
  | 'ld'
  | 'retention'
  | 'defects'
  | 'suspension'
  | 'force_majeure'
  | 'dispute'
  | 'other'
export type ClauseStatus = 'draft' | 'confirmed' | 'rejected'

export interface ContractClause {
  id: string
  category: ClauseCategory
  reference: string | null
  title: string
  summary: string | null
  days: number | null
  excerpt: string | null
  documentId: string | null
  status: ClauseStatus
  source: 'model' | 'heuristic' | 'manual'
}

export interface ContractPreset {
  key: ContractForm
  label: string
  delayNoticeDays: number
  claimParticularsDays: number
  variationNoticeDays: number
  responseDays: number
  references: Record<string, string>
}

export interface ContractProfile {
  projectId: string
  exists: boolean
  form: ContractForm
  formLabel: string
  delayNoticeDays: number
  claimParticularsDays: number
  variationNoticeDays: number
  responseDays: number
  paymentDays: number | null
  defectsLiabilityDays: number | null
  ldCapPct: number | null
  documentIds: string[]
  clauses: ContractClause[]
  references: Record<string, string>
  extractedAt: string | null
  extractedModel: string | null
  confirmedBy: string | null
  confirmedAt: string | null
  updatedAt: string | null
  presets: ContractPreset[]
}

export interface ContractProfileInput {
  form?: ContractForm
  delayNoticeDays?: number | null
  claimParticularsDays?: number | null
  variationNoticeDays?: number | null
  responseDays?: number | null
  paymentDays?: number | null
  defectsLiabilityDays?: number | null
  ldCapPct?: number | null
  documentIds?: string[]
  clauses?: Array<Partial<ContractClause>>
  confirm?: boolean
}

export interface ClauseExtraction {
  degraded: boolean
  reason?: string | null
  profile: ContractProfile
  proposed: ContractClause[]
  suggestedPeriods: {
    delayNoticeDays: number | null
    variationNoticeDays: number | null
    paymentDays: number | null
    defectsLiabilityDays: number | null
  }
  documents: Array<{
    id: string
    title: string
    status: string | null
    chars: number
    readable: boolean
    error?: string
  }>
  windowsRead: number
}

export type NoticeEventRecordType =
  | 'weather_delay'
  | 'change_order'
  | 'rfi'
  | 'eot_claim'
  | 'correspondence'
export type NoticeStatus = 'missed' | 'due' | 'late' | 'served' | 'not_required'

export interface NoticeItem {
  recordType: NoticeEventRecordType
  recordId: string
  kind: 'delay' | 'variation' | 'incoming_notice'
  ref: string | null
  title: string
  date: string | null
  days: number
  activityIds: string[]
  required: boolean
  status: NoticeStatus
  periodDays: number
  clauseReference: string | null
  deadline: string | null
  daysLeft: number
  served: {
    id: string | null
    ref: string | null
    subject: string | null
    date: string | null
    via: 'link' | 'reference' | 'activity' | 'response'
    lateByDays: number
  } | null
  url: string
}

export interface NoticeMonitor {
  asOf: string
  profile: {
    form: ContractForm
    formLabel: string
    delayNoticeDays: number
    variationNoticeDays: number
    responseDays: number
    claimParticularsDays: number
    exists: boolean
  }
  summary: Record<NoticeStatus, number> & { dueSoon: number }
  items: NoticeItem[]
}

export interface NoticeDraft {
  degraded: boolean
  reason?: string | null
  event: NoticeItem
  draft: {
    subject: string
    body: string
    clauseRefs: string[]
    deadline: string | null
    daysLeft: number
  }
  message: {
    id: string
    provider: string | null
    model: string | null
    feedback: 'up' | 'down' | null
  } | null
}

export interface EotAssessment {
  degraded: boolean
  reason?: string | null
  claim: {
    id: string
    ref: string
    eventName: string
    status: string
    delayDays: number
    eotDaysGranted: number
  }
  assessment: {
    entitlement: 'likely' | 'partial' | 'unlikely'
    recommendedDays: number
    basis: string[]
    gaps: string[]
    concurrency: string[]
    noticeCompliance: string
    narrative: string
    claimLetter: string | null
  }
  notices: NoticeItem[]
  evidence: {
    window: { from: string | null; to: string | null }
    logDelays: Array<{
      id: string
      date: string | null
      type: string
      description: string
      hoursLost: number
    }>
    attachments: Array<{ id: string; fileName: string | null }>
    correspondence: Array<{
      ref: string | null
      subject: string | null
      date: string | null
      relationType: string
    }>
  }
  message: {
    id: string
    provider: string | null
    model: string | null
    feedback: 'up' | 'down' | null
  } | null
}

const base = (projectId: string) => `/projects/${projectId}/contract`
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)
export const contractKey = (projectId: string) =>
  ['contract', projectId] as const

export const useContractProfile = (projectId: string, enabled = true) =>
  useQuery<ContractProfile>({
    queryKey: [...contractKey(projectId), 'profile'],
    queryFn: () => data<ContractProfile>(apiClient.get(base(projectId))),
    enabled: Boolean(projectId) && enabled,
  })

export const useUpdateContractProfile = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ContractProfileInput) =>
      data<ContractProfile>(apiClient.put(base(projectId), payload)),
    onSuccess: () => qc.invalidateQueries({ queryKey: contractKey(projectId) }),
  })
}

export const useExtractContractClauses = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { documentIds?: string[] }) =>
      data<ClauseExtraction>(
        apiClient.post(`${base(projectId)}/extract`, payload, {
          timeout: 300_000,
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: contractKey(projectId) }),
  })
}

export const useNoticeMonitor = (projectId: string, enabled = true) =>
  useQuery<NoticeMonitor>({
    queryKey: [...contractKey(projectId), 'notices'],
    queryFn: () =>
      data<NoticeMonitor>(apiClient.get(`${base(projectId)}/notices`)),
    staleTime: 60_000,
    enabled: Boolean(projectId) && enabled,
  })

export const useDraftNotice = (projectId: string) =>
  useMutation({
    mutationFn: (payload: {
      recordType: NoticeEventRecordType
      recordId: string
      instructions?: string | null
    }) =>
      data<NoticeDraft>(
        apiClient.post(`${base(projectId)}/notices/draft`, payload, {
          timeout: 120_000,
        })
      ),
  })

export const useCreateNotice = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      recordType: NoticeEventRecordType
      recordId: string
      subject: string
      body: string
      activityId?: string | null
    }) =>
      data<{
        correspondence: { id: string; ref: string }
        linked: boolean
        url: string
      }>(apiClient.post(`${base(projectId)}/notices`, payload)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contractKey(projectId) })
      qc.invalidateQueries({ queryKey: ['correspondence', projectId] })
      qc.invalidateQueries({ queryKey: ['doc-dashboard', projectId] })
    },
  })
}

export const useAssessEotClaim = (projectId: string) =>
  useMutation({
    mutationFn: ({ claimId }: { claimId: string }) =>
      data<EotAssessment>(
        apiClient.post(
          `/projects/${projectId}/eot/${claimId}/ai/assess`,
          {},
          { timeout: 120_000 }
        )
      ),
  })

export const useApplyEotAssessment = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      claimId,
      analysis,
      claimLetter,
    }: {
      claimId: string
      analysis?: string | null
      claimLetter?: string | null
    }) =>
      data<{ applied: { analysis: boolean; claimLetter: boolean } }>(
        apiClient.post(`/projects/${projectId}/eot/${claimId}/ai/apply`, {
          ...(analysis !== undefined ? { analysis } : {}),
          ...(claimLetter !== undefined ? { claimLetter } : {}),
        })
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eot-claims', projectId] })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}
