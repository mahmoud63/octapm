import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { toast } from 'sonner'
import { apiClient } from '@/services/api/client'
import { activityDetailKey, boqItemDetailKey } from '@/features/controls/hooks/use-controls-detail'
import { projectSetupReadinessKey } from '@/features/projects/hooks/use-projects'

/**
 * Project Controls › Mapping (PC-3): the BOQ ↔ activity allocation matrix,
 * its coverage by structure, the mapping-file import and the rule-based
 * suggestions, all served from /projects/:id/activity-boq-allocations.
 *
 * The allocation rows themselves and their lifecycle (create, edit, submit,
 * approve, reject) keep the hooks in features/boq/hooks/use-boq; this file
 * adds what the mapping view needs beside them.
 */

export type AllocationBasis = 'quantity' | 'amount' | 'weight'
export type AllocationStatus = 'draft' | 'submitted' | 'approved' | 'rejected'
export type MappingRule = 'required' | 'optional' | 'not_applicable'
export type MappingState =
  | 'unmapped'
  | 'partial'
  | 'complete'
  | 'over'
  | 'not_applicable'
export type CoverageGroupBy =
  | 'none'
  | 'wbs'
  | 'section'
  | 'location'
  | 'costCode'
  | 'package'
export type SuggestionSource =
  | 'ai'
  | 'rule:code'
  | 'rule:wbs'
  | 'rule:location'
  | 'rule:name'
  | 'rule:costcode'
  | 'import'

export interface MappingWarning {
  code: string
  severity: 'warning'
  message: string
  details?: Record<string, unknown>
}

export interface MappingAllocation {
  id: string
  projectId: string
  boqItemId: string
  activityId: string
  quantity: number
  amount: number
  weight: number
  basis: AllocationBasis
  source: string
  status: AllocationStatus
  isActive: boolean
  notes: string | null
  locationId: string | null
  unitCode: string | null
  suggestedBy: SuggestionSource | null
  confidence: number | null
  importBatchId: string | null
  rejectedReason?: string | null
  createdAt?: string
  updatedAt?: string
  warnings?: MappingWarning[]
  boqItem: {
    id: string
    code: string
    description: string
    unit: string | null
    unitCode: string | null
    quantity: number
    rate: number
    amount: number
    section: string | null
    sortOrder: number
    mappingRule: MappingRule
    wbsNodeId: string | null
    locationId: string | null
    costCodeId: string | null
  } | null
  activity: {
    id: string
    activityId: string
    activityCode: string | null
    p6ActivityId: string | null
    name: string
    wbsCode: string | null
    category: string | null
    sortOrder: number
    wbsNodeId: string | null
    locationId: string | null
    duration: number | null
    startDate: string | null
    endDate: string | null
  } | null
}

export interface CoverageCounts {
  unmapped: number
  partial: number
  complete: number
  over: number
  notApplicable: number
}

export interface CoverageItem {
  boqItemId: string
  code: string
  description: string
  section: string | null
  mappingRule: MappingRule
  wbsNodeId: string | null
  locationId: string | null
  costCodeId: string | null
  unitCode: string | null
  quantity: number
  amount: number
  activeAllocatedQuantity: number
  activeAllocatedAmount: number
  approvedAllocatedQuantity: number
  approvedAllocatedAmount: number
  pendingAllocatedAmount: number
  unallocatedQuantity: number
  unallocatedAmount: number
  /** An optional row's remainder: inside unallocated, reported apart. */
  optionalUnallocatedQuantity: number
  optionalUnallocatedAmount: number
  notApplicableQuantity: number
  notApplicableAmount: number
  earnedValue: number
  certifiedValue: number
  allocationCount: number
  mappingState: MappingState
  /** The group this row falls under for the summary's groupBy (absent for none). */
  groupKey?: string
}

export interface CoverageGroup {
  key: string
  label: string
  code: string | null
  path: string | null
  itemCount: number
  totalBoqQuantity: number
  totalBoqAmount: number
  allocatableBoqAmount: number
  approvedAllocatedQuantity: number
  approvedAllocatedAmount: number
  pendingAllocatedAmount: number
  unallocatedQuantity: number
  unallocatedAmount: number
  optionalUnallocatedQuantity: number
  optionalUnallocatedAmount: number
  notApplicableQuantity: number
  notApplicableAmount: number
  earnedValue: number
  certifiedValue: number
  coveragePct: number
  counts: CoverageCounts
}

export interface CoverageSummary {
  groupBy: CoverageGroupBy
  cutoffDate: string | null
  totalBoqQuantity: number
  totalBoqAmount: number
  allocatableBoqAmount: number
  activeAllocatedAmount: number
  approvedAllocatedAmount: number
  pendingAllocatedAmount: number
  unallocatedAmount: number
  /** Inside unallocatedAmount; readiness warns about it rather than blocking. */
  optionalUnallocatedAmount: number
  notApplicableAmount: number
  earnedValue: number
  certifiedValue: number
  coveragePct: number
  counts: CoverageCounts
  groups: CoverageGroup[]
  items: CoverageItem[]
}

export interface MappingSuggestion {
  boqItemId: string
  boqCode: string
  activityId: string
  activityCode: string
  activityName: string
  wbsCode: string | null
  suggestedBy: SuggestionSource
  confidence: number
  reasons: string[]
}

export interface SuggestionsResponse {
  suggestions: MappingSuggestion[]
  byItem: Array<{
    boqItemId: string
    code: string
    candidates: MappingSuggestion[]
    skipped: 'not_applicable' | null
  }>
  summary: {
    items: number
    itemsWithCandidates: number
    candidates: number
    limitPerItem: number
  }
}

export interface AllocationDraftPayload {
  boqItemId: string
  activityId: string
  quantity?: number
  amount?: number
  weight?: number
  basis?: AllocationBasis
  notes?: string | null
  locationId?: string | null
  suggestedBy?: SuggestionSource | null
  confidence?: number | null
}

export interface BulkResponse {
  createdCount: number
  failedCount: number
  created: MappingAllocation[]
  failed: Array<{
    index: number
    boqItemId: string
    activityId: string
    code: string
    message: string
  }>
}

export interface ImportReportRow {
  rowIndex: number
  boqCode?: string
  activityCode?: string
  reason?: string
  message?: string
  basis?: AllocationBasis
  quantity?: number
  amount?: number
  code?: string
  allocationId?: string
}

export interface ImportReport {
  dryRun: boolean
  batchId: string | null
  rowCount: number
  columns: string[]
  summary: {
    matched: number
    unmatched: number
    existing: number
    breaches: number
    notApplicable: number
    invalid: number
    created: number
    failed: number
    totalAmount: number
  }
  matched: ImportReportRow[]
  unmatched: ImportReportRow[]
  existing: ImportReportRow[]
  breaches: ImportReportRow[]
  notApplicable: ImportReportRow[]
  invalid: ImportReportRow[]
  created: ImportReportRow[]
  failed: ImportReportRow[]
  rowLimit: number
}

export interface UndoResponse {
  batchId: string
  total: number
  rejected: number
  keptApproved: number
  alreadyRejected: number
}

type ApiErrorResponse = { error?: { code?: string; message?: string } }

export const apiErrorMessage = (
  err: AxiosError<ApiErrorResponse>,
  fallback: string
) => err.response?.data?.error?.message ?? fallback

const base = (projectId: string) =>
  `/projects/${projectId}/activity-boq-allocations`

export const coverageKey = (projectId: string, groupBy: CoverageGroupBy) => [
  'allocation-coverage',
  projectId,
  groupBy,
]
export const suggestionsKey = (projectId: string) => [
  'allocation-suggestions',
  projectId,
]

/** Every reader of allocation figures, so a write shows everywhere at once. */
export const invalidateMappingConsumers = async (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['activity-boq-allocations', projectId] }),
    qc.invalidateQueries({ queryKey: ['allocation-coverage', projectId] }),
    qc.invalidateQueries({ queryKey: suggestionsKey(projectId) }),
    qc.invalidateQueries({ queryKey: ['boq', projectId] }),
    qc.invalidateQueries({ queryKey: ['schedule', projectId] }),
    qc.invalidateQueries({ queryKey: ['activities', projectId] }),
    qc.invalidateQueries({ queryKey: ['cost-summary', projectId] }),
    qc.invalidateQueries({ queryKey: ['audit-events', projectId] }),
    qc.invalidateQueries({ queryKey: projectSetupReadinessKey(projectId) }),
    // The PC-5 detail drawers show allocations, mapped quantity and the figures worked from them.
    qc.invalidateQueries({ queryKey: boqItemDetailKey(projectId) }),
    qc.invalidateQueries({ queryKey: activityDetailKey(projectId) }),
  ])
}

export const useAllocationCoverage = (
  projectId: string,
  groupBy: CoverageGroupBy = 'none'
) =>
  useQuery<CoverageSummary>({
    queryKey: coverageKey(projectId, groupBy),
    queryFn: () =>
      apiClient
        .get(`${base(projectId)}/coverage`, {
          params: groupBy === 'none' ? undefined : { groupBy },
        })
        .then((r) => r.data.data),
    enabled: Boolean(projectId),
  })

export const useMappingSuggestions = (projectId: string, enabled = true) =>
  useQuery<SuggestionsResponse>({
    queryKey: suggestionsKey(projectId),
    queryFn: () =>
      apiClient
        .get(`${base(projectId)}/suggestions`, { params: { limit: 3 } })
        .then((r) => r.data.data),
    enabled: Boolean(projectId) && enabled,
  })

/**
 * One draft from the matrix: whichever figure was typed goes as the basis
 * and the service derives the rest; an accepted suggestion carries its
 * provenance. The BOQ panel's hook insists on a quantity, which a cell does
 * not always have.
 */
export function useCreateAllocationDraft(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: AllocationDraftPayload) =>
      apiClient
        .post(base(projectId), payload)
        .then((r) => r.data.data as MappingAllocation),
    onSuccess: async (allocation) => {
      const warnings = allocation.warnings ?? []
      if (warnings.length > 0) {
        toast.warning(`Draft created with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${warnings[0].message}`)
      } else {
        toast.success('Draft created')
      }
      await invalidateMappingConsumers(qc, projectId)
    },
    onError: (err: AxiosError<ApiErrorResponse>) =>
      toast.error(apiErrorMessage(err, 'Could not create the allocation')),
  })
}

export function useUpdateAllocationDraft(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      allocationId,
      data,
    }: {
      allocationId: string
      data: Partial<Omit<AllocationDraftPayload, 'boqItemId' | 'activityId'>>
    }) =>
      apiClient
        .patch(`${base(projectId)}/${allocationId}`, data)
        .then((r) => r.data.data as MappingAllocation),
    onSuccess: async () => {
      toast.success('Allocation updated')
      await invalidateMappingConsumers(qc, projectId)
    },
    onError: (err: AxiosError<ApiErrorResponse>) =>
      toast.error(apiErrorMessage(err, 'Could not update the allocation')),
  })
}

export function useCreateAllocationsBulk(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (allocations: AllocationDraftPayload[]) =>
      apiClient
        .post(`${base(projectId)}/bulk`, { allocations })
        .then((r) => r.data.data as BulkResponse),
    onSuccess: async (result) => {
      if (result.failedCount > 0) {
        toast.warning(
          `${result.createdCount} draft${result.createdCount === 1 ? '' : 's'} created, ${result.failedCount} refused`
        )
      } else {
        toast.success(
          `${result.createdCount} draft${result.createdCount === 1 ? '' : 's'} created`
        )
      }
      await invalidateMappingConsumers(qc, projectId)
    },
    onError: (err: AxiosError<ApiErrorResponse>) =>
      toast.error(apiErrorMessage(err, 'Bulk allocation failed')),
  })
}

export function useSetMappingRules(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      rule: MappingRule
      itemIds?: string[]
      section?: string
    }) =>
      apiClient
        .patch(`${base(projectId)}/mapping-rules`, payload)
        .then(
          (r) =>
            r.data.data as {
              rule: MappingRule
              matched: number
              updated: number
              itemIds: string[]
            }
        ),
    onSuccess: async (result) => {
      toast.success(
        `Rule set on ${result.updated} row${result.updated === 1 ? '' : 's'}`
      )
      await invalidateMappingConsumers(qc, projectId)
    },
    onError: (err: AxiosError<ApiErrorResponse>) =>
      toast.error(apiErrorMessage(err, 'Could not change the mapping rule')),
  })
}

export function useMappingImport(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, dryRun }: { file: File; dryRun: boolean }) => {
      const form = new FormData()
      form.append('file', file)
      return apiClient
        .post(`${base(projectId)}/import`, form, {
          params: dryRun ? { dryRun: true } : undefined,
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((r) => r.data.data as ImportReport)
    },
    onSuccess: async (report) => {
      if (!report.dryRun) {
        toast.success(
          `${report.summary.created} import draft${report.summary.created === 1 ? '' : 's'} created`
        )
        await invalidateMappingConsumers(qc, projectId)
      }
    },
    onError: (err: AxiosError<ApiErrorResponse>) =>
      toast.error(apiErrorMessage(err, 'The mapping file was refused')),
  })
}

export function useUndoMappingImport(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (batchId: string) =>
      apiClient
        .post(`${base(projectId)}/import/${batchId}/undo`)
        .then((r) => r.data.data as UndoResponse),
    onSuccess: async (result) => {
      toast.success(
        `${result.rejected} import draft${result.rejected === 1 ? '' : 's'} rejected${result.keptApproved ? `, ${result.keptApproved} approved kept` : ''}`
      )
      await invalidateMappingConsumers(qc, projectId)
    },
    onError: (err: AxiosError<ApiErrorResponse>) =>
      toast.error(apiErrorMessage(err, 'Could not undo the import')),
  })
}

/** Labels for the badges. */
export const ruleLabel: Record<MappingRule, string> = {
  required: 'Required',
  optional: 'Optional',
  not_applicable: 'N/A',
}

export const stateLabel: Record<MappingState, string> = {
  unmapped: 'Unmapped',
  partial: 'Partial',
  complete: 'Complete',
  over: 'Over',
  not_applicable: 'N/A',
}

export const statusLabel: Record<AllocationStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
}
