import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/** BIM / 5D commercial intelligence: `/projects/{id}/bim/5d`. */

const base = (projectId: string) => `/projects/${projectId}/bim/5d`
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)
const key = (projectId: string) => ['bim-5d', projectId] as const

export interface UnitSum {
  value: number | null
  unit: string | null
  byUnit?: Array<{ unit: string; value: number | null }>
}

export interface Bim5dAlert {
  key: string
  label: string
  count: number
  severity: 'ok' | 'info' | 'warning' | 'critical'
  action: 'mapping' | 'reconciliation' | 'changes'
}

export interface Bim5dFormat {
  format: string
  versions: string[]
  status: 'supported' | 'not_supported'
  note: string
}

export interface Bim5dOverview {
  models: {
    count: number
    current: Array<{ id: string; name: string; discipline: string | null; revision: string; elements: number; revisionDate: string }>
  }
  elements: { total: number; mapped: number; unmapped: number; mappedPct: number; unmappedPct: number; withBoq: number; withLocation: number }
  quantities: null | {
    note: string
    contract: UnitSum
    bim: UnitSum
    executed: UnitSum
    approved: UnitSum
    certified: UnitSum
    paid: UnitSum
    potentialChange: UnitSum
  }
  alerts: Bim5dAlert[]
  formats: Bim5dFormat[]
}

export interface Bim5dRevision {
  id: string
  revision: string
  version: number
  isCurrent: boolean
  status: string
  revisionDate: string
  uploadedBy: string | null
  uploadedAt: string
  parsedAt: string | null
  sourceFormat: string
  documentId: string | null
  fileName: string | null
  checksum: string | null
  previousRevisionId: string | null
  elementCount: number
  linkedCount: number
}

export interface Bim5dRegister {
  models: Array<{ name: string; discipline: string | null; currentRevisionId: string; latestRevision: string; revisions: Bim5dRevision[] }>
  formats: Bim5dFormat[]
}

export interface Figure {
  value: number | null
  available: boolean
  reason: string | null
}

export type ReconStatus = 'UNMAPPED' | 'OVER_CONTRACT' | 'BELOW_CERTIFIED' | 'UNDER_CONTRACT' | 'RULE_ISSUES' | 'MATCHED'

export interface ReconRow {
  boqItemId: string
  code: string
  description: string
  unit: string | null
  contract: number | null
  bim: number | null
  mappedElements: number
  executed: number | null
  approved: Figure
  certified: Figure
  paid: Figure
  variation: number | null
  difference: number | null
  status: ReconStatus
  rule: { quantityField: string | null; status: RuleStatus }
  ruleChecks: { valid: number; warning: number; invalid: number; notConfigured: number }
}

export interface Reconciliation {
  models: Array<{ id: string; name: string; revision: string }>
  tolerancePct: number
  rows: ReconRow[]
  basis: Record<string, string>
}

export type RuleStatus = 'VALID' | 'WARNING' | 'INVALID' | 'NOT_CONFIGURED'

export interface MeasurementRule {
  id: string
  boqItemId: string
  quantityField: string
  allowedTypes: string[]
  factor: number
  rounding: number
  unit: string | null
  includeText: string | null
  excludeText: string | null
  notes: string | null
}

export interface BoqItemElements {
  boqItem: { id: string; code: string; description: string; unit: string | null; contract: number | null }
  rule: MeasurementRule | null
  total: number | null
  items: Array<{
    linkId: string
    elementId: string
    globalId: string
    ifcType: string
    name: string | null
    tag: string | null
    storeyName: string | null
    model: string
    quantityField: string | null
    rawQuantity: number | null
    factor: number | null
    quantity: number | null
    unit: string | null
    method: string
    check: { status: RuleStatus; reasons: string[] }
  }>
}

export interface Provenance {
  element: { id: string; globalId: string; ifcType: string; name: string | null; typeName: string | null; tag: string | null; storeyName: string | null }
  source: { modelId: string; model: string; revision: string; discipline: string | null; revisionDate: string; isCurrentRevision: boolean }
  location: { id: string; label: string } | null
  activity: { id: string; label: string } | null
  wbs: { id: string; label: string } | null
  quantities: Array<{
    boqItem: { id: string; code?: string | null; description?: string; unit?: string | null }
    measurement: string | null
    measurementRule: MeasurementRule | null
    rawQuantity: number | null
    rawUnit: string | null
    factor: number | null
    quantity: number | null
    unit: string | null
    method: string
    mappedBy: string | null
    mappedAt: string
    check: { status: RuleStatus; reasons: string[] }
  }>
  quantitiesWithheld?: string
  measured: Record<string, { value: number; unit: string }>
}

export const useBim5dOverview = (projectId: string) =>
  useQuery<Bim5dOverview>({ queryKey: [...key(projectId), 'overview'], queryFn: () => data(apiClient.get(`${base(projectId)}/overview`)) })

export const useBim5dRegister = (projectId: string, enabled = true) =>
  useQuery<Bim5dRegister>({ queryKey: [...key(projectId), 'register'], queryFn: () => data(apiClient.get(`${base(projectId)}/register`)), enabled })

export const useBim5dReconciliation = (projectId: string, enabled = true) =>
  useQuery<Reconciliation>({ queryKey: [...key(projectId), 'reconciliation'], queryFn: () => data(apiClient.get(`${base(projectId)}/reconciliation`)), enabled })

export const useBim5dRules = (projectId: string, enabled = true) =>
  useQuery<{ items: MeasurementRule[]; quantityFields: string[] }>({ queryKey: [...key(projectId), 'rules'], queryFn: () => data(apiClient.get(`${base(projectId)}/rules`)), enabled })

export const useBoqItemElements = (projectId: string, boqItemId: string | null) =>
  useQuery<BoqItemElements>({ queryKey: [...key(projectId), 'boq-item', boqItemId], queryFn: () => data(apiClient.get(`${base(projectId)}/boq-items/${boqItemId}/elements`)), enabled: Boolean(boqItemId) })

export const useBimProvenance = (projectId: string, elementId: string | null, boqItemId?: string | null) =>
  useQuery<Provenance>({ queryKey: [...key(projectId), 'provenance', elementId, boqItemId ?? null], queryFn: () => data(apiClient.get(`${base(projectId)}/elements/${elementId}/provenance`, { params: boqItemId ? { boqItemId } : undefined })), enabled: Boolean(elementId) })

export const useSaveMeasurementRule = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ boqItemId, ...payload }: { boqItemId: string; quantityField: string; allowedTypes?: string[]; factor?: number; unit?: string | null; includeText?: string | null; excludeText?: string | null; notes?: string | null }) =>
      data<MeasurementRule>(apiClient.put(`${base(projectId)}/rules/${boqItemId}`, payload)),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  })
}

export const useApplyBimSuggestions = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ modelId, kinds }: { modelId: string; kinds: Array<'location' | 'boq'> }) =>
      data<{ locations: number; boqLinks: number }>(apiClient.post(`${base(projectId)}/models/${modelId}/apply-suggestions`, { kinds })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key(projectId) })
      qc.invalidateQueries({ queryKey: ['bim'] })
    },
  })
}
