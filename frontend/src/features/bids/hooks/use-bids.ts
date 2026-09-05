import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Bid management (OCTA-PRE-BID-027): packages built from BOQ sections,
 * bidders invited with personal portal links, questions and addenda,
 * leveling of submitted bids and award → commitment.
 */

export type BidPackageStatus =
  | 'draft'
  | 'open'
  | 'closed'
  | 'awarded'
  | 'cancelled'
export type InvitationStatus =
  | 'invited'
  | 'viewed'
  | 'declined'
  | 'submitted'
  | 'withdrawn'
export type BidStatus =
  | 'draft'
  | 'submitted'
  | 'withdrawn'
  | 'awarded'
  | 'unsuccessful'

export const PACKAGE_STATUS_LABEL: Record<BidPackageStatus, string> = {
  draft: 'Draft',
  open: 'Open for bids',
  closed: 'Closed',
  awarded: 'Awarded',
  cancelled: 'Cancelled',
}

export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  invited: 'Invited',
  viewed: 'Viewed',
  declined: 'Declined',
  submitted: 'Bid submitted',
  withdrawn: 'Withdrawn',
}

export interface BidLine {
  id: string
  lineNumber: number
  boqItemId: string | null
  section: string | null
  code: string | null
  description: string
  unit: string | null
  qty: number
  estimateRate?: number | null
  estimateAmount?: number | null
  budgetLineId?: string | null
  costCodeId?: string | null
  activityId?: string | null
  sortOrder: number
}

export interface BidInvitation {
  id: string
  vendorCompanyId: string | null
  companyName: string
  contactName: string | null
  contactEmail: string
  status: InvitationStatus
  invitedAt: string | null
  viewedAt: string | null
  lastAccessAt: string | null
  expiresAt: string | null
  declinedReason: string | null
  remindersSent: number
  bidStatus: BidStatus | null
  bidTotal: number | null
  portalUrl?: string | null
}

export interface BidAddendum {
  id: string
  number: number
  title: string
  body: string | null
  issuedAt: string | null
  issuedBy: string | null
}

export interface BidQuestion {
  id: string
  question: string
  askedAt: string | null
  askedBy?: string | null
  invitationId?: string | null
  companyName?: string | null
  answer: string | null
  answeredAt: string | null
  shared: boolean
  status: 'open' | 'answered'
  mine?: boolean
}

export interface BidRecordLine {
  id: string
  packageLineId: string
  rate: number | null
  amount: number
  included: boolean
  note: string | null
}

export interface BidRecord {
  id: string
  invitationId: string
  companyName?: string | null
  contactName?: string | null
  contactEmail?: string | null
  vendorCompanyId?: string | null
  version: number
  status: BidStatus
  total: number
  currency: string | null
  notes: string | null
  inclusions: string | null
  exclusions: string | null
  validityDays: number | null
  leadTimeDays: number | null
  documentId: string | null
  submittedAt: string | null
  submittedBy: string | null
  withdrawnAt: string | null
  awardedAt: string | null
  lines: BidRecordLine[]
  updatedAt: string | null
}

export interface BidPackage {
  id: string
  projectId: string
  number: number
  ref: string
  title: string
  description: string | null
  instructions: string | null
  status: BidPackageStatus
  dueAt: string | null
  questionsDueAt: string | null
  currency: string
  boqSections: string[]
  commitmentType: 'subcontract' | 'purchase_order'
  publishedAt: string | null
  closedAt: string | null
  awardedAt: string | null
  awardedBidId: string | null
  awardedCommitmentId: string | null
  softAwardBidId: string | null
  isPastDue: boolean
  counts: {
    lines: number
    invitations: number
    questions: number
    bids: number
    openQuestions: number
  }
  createdBy: string | null
  createdAt: string | null
  updatedAt: string | null
  lines?: BidLine[]
  invitations?: BidInvitation[]
  addenda?: BidAddendum[]
  questions?: BidQuestion[]
  bids?: BidRecord[]
}

export interface BidPackageInput {
  title?: string
  description?: string | null
  instructions?: string | null
  dueAt?: string | null
  questionsDueAt?: string | null
  currency?: string
  commitmentType?: 'subcontract' | 'purchase_order'
  boqSections?: string[]
}

export interface BidLevelingCell {
  rate: number | null
  amount: number | null
  included: boolean
  note: string | null
  plugged: boolean
  normalizedAmount: number | null
  isLow: boolean
}

export interface BidLevelingBidder {
  bidId: string
  invitationId: string
  companyName: string | null
  status: BidStatus
  total: number
  normalizedTotal: number
  pluggedLines: number
  lowLines: number
  rank: number
  validityDays: number | null
  leadTimeDays: number | null
  inclusions: string | null
  exclusions: string | null
  notes: string | null
  documentId: string | null
  submittedAt: string | null
  isSoftAward: boolean
  isAwarded: boolean
}

export interface BidLeveling {
  package: BidPackage
  lines: BidLine[]
  lineStats: Record<
    string,
    {
      low: number | null
      high: number | null
      avg: number | null
      priced: number
      spread: number | null
      plug: number
    }
  >
  bidders: BidLevelingBidder[]
  cells: Record<string, Record<string, BidLevelingCell>>
  estimateTotal: number
}

const key = (projectId: string) => ['bids', projectId] as const
const base = (projectId: string) => `/projects/${projectId}/bids`
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)

const invalidate = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: key(projectId) })
  qc.invalidateQueries({ queryKey: ['commitments', projectId] })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
}

export const useBidBoqSections = (projectId: string, enabled = true) =>
  useQuery<
    Array<{ section: string; key: string; items: number; amount: number }>
  >({
    queryKey: [...key(projectId), 'boq-sections'],
    queryFn: () =>
      data<{ items: never[] }>(
        apiClient.get(`${base(projectId)}/boq-sections`)
      ).then((result) => result.items),
    enabled: Boolean(projectId) && enabled,
  })

export const useBidPackages = (
  projectId: string,
  status: BidPackageStatus | 'all' = 'all'
) =>
  useQuery<BidPackage[]>({
    queryKey: [...key(projectId), 'list', status],
    queryFn: () =>
      data<{ items: BidPackage[] }>(
        apiClient.get(base(projectId), {
          params: status !== 'all' ? { status } : {},
        })
      ).then((result) => result.items),
    enabled: Boolean(projectId),
  })

export const useBidPackage = (projectId: string, packageId: string | null) =>
  useQuery<BidPackage>({
    queryKey: [...key(projectId), 'detail', packageId ?? ''],
    queryFn: () =>
      data<BidPackage>(apiClient.get(`${base(projectId)}/${packageId}`)),
    enabled: Boolean(projectId && packageId),
  })

export const useCreateBidPackage = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: BidPackageInput) =>
      data<BidPackage>(apiClient.post(base(projectId), payload)),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useUpdateBidPackage = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      payload,
    }: {
      packageId: string
      payload: BidPackageInput
    }) =>
      data<BidPackage>(
        apiClient.patch(`${base(projectId)}/${packageId}`, payload)
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useCancelBidPackage = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      reason,
    }: {
      packageId: string
      reason?: string
    }) =>
      data<BidPackage>(
        apiClient.delete(`${base(projectId)}/${packageId}`, {
          data: { reason },
        })
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export type BidPackageAction = 'publish' | 'close'

export const useBidPackageAction = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      action,
      body,
    }: {
      packageId: string
      action: BidPackageAction | 'reopen' | 'award/revoke'
      body?: Record<string, unknown>
    }) =>
      data<BidPackage>(
        apiClient.post(`${base(projectId)}/${packageId}/${action}`, body ?? {})
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useAddBidLinesFromBoq = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      sections,
      boqItemIds,
    }: {
      packageId: string
      sections?: string[]
      boqItemIds?: string[]
    }) =>
      data<BidPackage>(
        apiClient.post(`${base(projectId)}/${packageId}/lines/from-boq`, {
          ...(sections ? { sections } : {}),
          ...(boqItemIds ? { boqItemIds } : {}),
        })
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useSaveBidLine = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      lineId,
      payload,
    }: {
      packageId: string
      lineId?: string | null
      payload: Partial<BidLine>
    }) =>
      data<BidPackage>(
        lineId
          ? apiClient.patch(
              `${base(projectId)}/${packageId}/lines/${lineId}`,
              payload
            )
          : apiClient.post(`${base(projectId)}/${packageId}/lines`, payload)
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useDeleteBidLine = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      lineId,
    }: {
      packageId: string
      lineId: string
    }) =>
      data<BidPackage>(
        apiClient.delete(`${base(projectId)}/${packageId}/lines/${lineId}`)
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useInviteBidders = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      invitations,
    }: {
      packageId: string
      invitations: Array<{
        vendorCompanyId?: string | null
        companyName?: string | null
        contactName?: string | null
        contactEmail?: string | null
      }>
    }) =>
      data<{ items: BidInvitation[] }>(
        apiClient.post(`${base(projectId)}/${packageId}/invitations`, {
          invitations,
        })
      ).then((result) => result.items),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useResendBidInvitation = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      invitationId,
    }: {
      packageId: string
      invitationId: string
    }) =>
      data<BidInvitation>(
        apiClient.post(
          `${base(projectId)}/${packageId}/invitations/${invitationId}/resend`,
          {}
        )
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useRemoveBidInvitation = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      invitationId,
    }: {
      packageId: string
      invitationId: string
    }) =>
      data<{ deleted: boolean }>(
        apiClient.delete(
          `${base(projectId)}/${packageId}/invitations/${invitationId}`
        )
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useIssueBidAddendum = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      title,
      body,
    }: {
      packageId: string
      title: string
      body?: string | null
    }) =>
      data<BidAddendum>(
        apiClient.post(`${base(projectId)}/${packageId}/addenda`, {
          title,
          body,
        })
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useAnswerBidQuestion = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      questionId,
      answer,
      shared,
    }: {
      packageId: string
      questionId: string
      answer: string
      shared: boolean
    }) =>
      data<BidQuestion>(
        apiClient.post(
          `${base(projectId)}/${packageId}/questions/${questionId}/answer`,
          { answer, shared }
        )
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useBidLeveling = (projectId: string, packageId: string | null) =>
  useQuery<BidLeveling>({
    queryKey: [...key(projectId), 'leveling', packageId ?? ''],
    queryFn: () =>
      data<BidLeveling>(
        apiClient.get(`${base(projectId)}/${packageId}/leveling`)
      ),
    enabled: Boolean(projectId && packageId),
  })

export const useAwardBid = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ packageId, bidId }: { packageId: string; bidId: string }) =>
      data<BidPackage>(
        apiClient.post(`${base(projectId)}/${packageId}/award`, { bidId })
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useConfirmBidAward = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      packageId,
      payload,
    }: {
      packageId: string
      payload: {
        bidId?: string | null
        title?: string | null
        retentionRate?: number | null
        startDate?: string | null
        endDate?: string | null
      }
    }) =>
      data<{
        package: BidPackage
        commitment: {
          id: string
          ref: string | null
          status: string | null
        } | null
      }>(
        apiClient.post(`${base(projectId)}/${packageId}/award/confirm`, payload)
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const downloadBidLeveling = async (
  projectId: string,
  packageId: string
) => {
  const response = await apiClient.get(
    `${base(projectId)}/${packageId}/leveling.xlsx`,
    { responseType: 'blob', timeout: 120_000 }
  )
  const disposition = String(response.headers?.['content-disposition'] ?? '')
  const match = /filename="?([^";]+)"?/.exec(disposition)
  const url = URL.createObjectURL(new Blob([response.data]))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = match?.[1] ?? 'leveling.xlsx'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export const formatBidMoney = (
  value: number | null | undefined,
  currency?: string | null
) => {
  if (value === null || value === undefined) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`
  }
}

export const formatBidDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : '—'
