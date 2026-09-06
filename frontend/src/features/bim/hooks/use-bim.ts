import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * BIM models (OCTA-BIM-IFC-043): the IFC data layer — spatial breakdown,
 * elements with properties and quantities, and links to the project's records.
 */

export type BimStatus = 'processing' | 'ready' | 'failed'
export type BimDiscipline =
  | 'architectural'
  | 'structural'
  | 'mechanical'
  | 'electrical'
  | 'plumbing'
  | 'civil'
  | 'coordination'
  | 'other'
export type BimLinkRecordType =
  | 'activity'
  | 'location'
  | 'boq_item'
  | 'punch_item'
  | 'observation'
  | 'rfi'
  | 'ncr'
export type BimRelationType = 'represents' | 'affects' | 'reference'

export const BIM_DISCIPLINES: BimDiscipline[] = [
  'architectural',
  'structural',
  'mechanical',
  'electrical',
  'plumbing',
  'civil',
  'coordination',
  'other',
]

export const BIM_STATUS_LABEL: Record<BimStatus, string> = {
  processing: 'Reading…',
  ready: 'Ready',
  failed: 'Failed',
}

export const LINK_RECORD_LABEL: Record<BimLinkRecordType, string> = {
  activity: 'Activity',
  location: 'Location',
  boq_item: 'BOQ item',
  punch_item: 'Punch item',
  observation: 'Observation',
  rfi: 'RFI',
  ncr: 'NCR',
}

export interface BimSpatialNode {
  globalId: string
  ifcType: string
  name: string | null
  longName: string | null
  elevation: number | null
  parentGlobalId: string | null
  elementCount: number
  children: BimSpatialNode[]
}

export interface BimTypeSummary {
  ifcType: string
  label: string
  count: number
  netVolume: number
  netArea: number
}

export interface BimModel {
  id: string
  projectId: string
  name: string
  discipline: BimDiscipline | null
  documentId: string | null
  fileName: string | null
  fileSize: number | null
  schema: string | null
  status: BimStatus
  version: number
  isCurrent: boolean
  supersededById: string | null
  ifcProjectName: string | null
  siteName: string | null
  buildingName: string | null
  units: Record<string, string>
  header?: Record<string, string | null>
  spatial?: BimSpatialNode[]
  typeSummary?: BimTypeSummary[]
  warnings: string[]
  elementCount: number
  entityCount: number
  storeyCount: number
  linkedCount: number
  parsedAt: string | null
  jobId: string | null
  error: string | null
  notes: string | null
  path: string
  uploadedBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface BimQuantities {
  netVolume?: number
  grossVolume?: number
  netArea?: number
  grossArea?: number
  length?: number
  width?: number
  height?: number
  perimeter?: number
  weight?: number
  count?: number
}

export interface BimLink {
  id: string
  modelId: string
  elementId: string
  element?: {
    id: string
    globalId: string
    ifcType: string
    name: string | null
    tag: string | null
    storeyName: string | null
  }
  recordType: BimLinkRecordType
  recordId: string
  recordTitle: string | null
  recordPath: string | null
  relationType: BimRelationType
  notes: string | null
  createdBy: string | null
  createdAt: string | null
}

export interface BimElement {
  id: string
  modelId: string
  globalId: string
  ifcType: string
  typeLabel: string
  name: string | null
  description?: string | null
  objectType: string | null
  predefinedType: string | null
  tag: string | null
  typeName: string | null
  storeyName: string | null
  storeyGlobalId: string | null
  elevation: number | null
  spatialPath: string | null
  materials: string[]
  properties?: Record<string, Record<string, string | number | boolean>>
  quantities: BimQuantities
  linkCount: number
  links?: BimLink[]
  createdAt: string | null
}

export interface BimElementFilters {
  ifcType?: string
  storeyGlobalId?: string
  typeName?: string
  q?: string
  linked?: 'true' | 'false'
}

export interface BimQuantityRow {
  key: string
  label: string
  ifcType: string | null
  storeyGlobalId: string | null
  elements: number
  netVolume: number
  grossVolume: number
  netArea: number
  grossArea: number
  length: number
  weight: number
  count: number
}

const base = (projectId: string) => `/projects/${projectId}/bim`
const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)
const clean = (filters: BimElementFilters) =>
  Object.fromEntries(
    Object.entries(filters).filter(
      ([, value]) => value !== undefined && value !== null && value !== ''
    )
  )

export const bimKeys = {
  all: (projectId: string) => ['bim', projectId] as const,
  models: (projectId: string, query: Record<string, string | undefined>) =>
    ['bim', projectId, 'models', query] as const,
  model: (projectId: string, modelId: string) =>
    ['bim', projectId, 'model', modelId] as const,
  spatial: (projectId: string, modelId: string) =>
    ['bim', projectId, 'spatial', modelId] as const,
  elements: (projectId: string, modelId: string, filters: BimElementFilters) =>
    ['bim', projectId, 'elements', modelId, filters] as const,
  element: (projectId: string, modelId: string, elementId: string) =>
    ['bim', projectId, 'element', modelId, elementId] as const,
  quantities: (
    projectId: string,
    modelId: string,
    filters: BimElementFilters,
    groupBy: string
  ) => ['bim', projectId, 'quantities', modelId, filters, groupBy] as const,
  links: (projectId: string, modelId: string) =>
    ['bim', projectId, 'links', modelId] as const,
  forRecord: (projectId: string, recordType: string, recordId: string) =>
    ['bim', projectId, 'record', recordType, recordId] as const,
}

const invalidate = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: bimKeys.all(projectId) })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
}

export const useBimModels = (
  projectId: string,
  query: { status?: string; discipline?: string; current?: string } = {}
) =>
  useQuery<{
    items: BimModel[]
    summary: {
      count: number
      current: number
      elements: number
      linked: number
      byStatus: Record<BimStatus, number>
    }
  }>({
    queryKey: bimKeys.models(projectId, query),
    queryFn: () =>
      data(apiClient.get(`${base(projectId)}/models`, { params: query })),
    enabled: Boolean(projectId),
    placeholderData: (previous) => previous,
    // While a model is being read, keep the list fresh.
    refetchInterval: (query_) =>
      (query_.state.data?.items ?? []).some(
        (item) => item.status === 'processing'
      )
        ? 4000
        : false,
  })

export const useBimModel = (projectId: string, modelId: string | null) =>
  useQuery<BimModel>({
    queryKey: bimKeys.model(projectId, modelId ?? ''),
    queryFn: () => data(apiClient.get(`${base(projectId)}/models/${modelId}`)),
    enabled: Boolean(projectId && modelId),
    refetchInterval: (query_) =>
      query_.state.data?.status === 'processing' ? 4000 : false,
  })

export const useBimSpatial = (projectId: string, modelId: string | null) =>
  useQuery<{ items: BimSpatialNode[]; storeys: BimSpatialNode[] }>({
    queryKey: bimKeys.spatial(projectId, modelId ?? ''),
    queryFn: () =>
      data(apiClient.get(`${base(projectId)}/models/${modelId}/spatial`)),
    enabled: Boolean(projectId && modelId),
  })

export const useBimElements = (
  projectId: string,
  modelId: string | null,
  filters: BimElementFilters
) =>
  useInfiniteQuery<{
    items: BimElement[]
    nextCursor: string | null
    total: number
  }>({
    queryKey: bimKeys.elements(projectId, modelId ?? '', filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      data(
        apiClient.get(`${base(projectId)}/models/${modelId}/elements`, {
          params: { ...clean(filters), limit: 100, cursor: pageParam },
        })
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(projectId && modelId),
  })

export const useBimElement = (
  projectId: string,
  modelId: string | null,
  elementId: string | null
) =>
  useQuery<BimElement>({
    queryKey: bimKeys.element(projectId, modelId ?? '', elementId ?? ''),
    queryFn: () =>
      data(
        apiClient.get(
          `${base(projectId)}/models/${modelId}/elements/${elementId}`
        )
      ),
    enabled: Boolean(projectId && modelId && elementId),
  })

export const useBimQuantities = (
  projectId: string,
  modelId: string | null,
  filters: BimElementFilters,
  groupBy: 'type' | 'storey'
) =>
  useQuery<{
    groupBy: string
    units: Record<string, string>
    items: BimQuantityRow[]
    totals: {
      elements: number
      netVolume: number
      netArea: number
      weight: number
    }
  }>({
    queryKey: bimKeys.quantities(projectId, modelId ?? '', filters, groupBy),
    queryFn: () =>
      data(
        apiClient.get(`${base(projectId)}/models/${modelId}/quantities`, {
          params: { ...clean(filters), groupBy },
        })
      ),
    enabled: Boolean(projectId && modelId),
  })

export const useBimLinks = (projectId: string, modelId: string | null) =>
  useQuery<{
    items: BimLink[]
    records: Array<{
      recordType: BimLinkRecordType
      recordId: string
      recordTitle: string | null
      recordPath: string | null
      elements: number
    }>
  }>({
    queryKey: bimKeys.links(projectId, modelId ?? ''),
    queryFn: () =>
      data(apiClient.get(`${base(projectId)}/models/${modelId}/links`)),
    enabled: Boolean(projectId && modelId),
  })

/** Every model element tied to one record — for the schedule and the registers. */
export const useBimElementsForRecord = (
  projectId: string,
  recordType: BimLinkRecordType,
  recordId: string | null,
  options: { enabled?: boolean } = {}
) =>
  useQuery<{
    items: Array<{
      linkId: string
      modelId: string
      modelName: string | null
      relationType: BimRelationType
      element: BimElement | null
    }>
    totals: { elements: number; netVolume: number; netArea: number }
  }>({
    queryKey: bimKeys.forRecord(projectId, recordType, recordId ?? ''),
    queryFn: () =>
      data(
        apiClient.get(
          `${base(projectId)}/records/${recordType}/${recordId}/elements`
        )
      ),
    enabled: Boolean(projectId && recordId) && (options.enabled ?? true),
  })

export const useUploadBimModel = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      file,
      name,
      discipline,
      notes,
    }: {
      file: File
      name?: string
      discipline?: string
      notes?: string
    }) => {
      const form = new FormData()
      form.append('file', file)
      if (name?.trim()) form.append('name', name.trim())
      if (discipline) form.append('discipline', discipline)
      if (notes?.trim()) form.append('notes', notes.trim())
      return data<BimModel>(
        apiClient.post(`${base(projectId)}/models`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      )
    },
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useUpdateBimModel = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      modelId,
      ...payload
    }: {
      modelId: string
      name?: string
      discipline?: string | null
      notes?: string | null
    }) =>
      data<BimModel>(
        apiClient.patch(`${base(projectId)}/models/${modelId}`, payload)
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useReparseBimModel = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (modelId: string) =>
      data<BimModel>(
        apiClient.post(`${base(projectId)}/models/${modelId}/reparse`, {})
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useDeleteBimModel = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (modelId: string) =>
      data<{ deleted: boolean }>(
        apiClient.delete(`${base(projectId)}/models/${modelId}`)
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useCreateBimLinks = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      modelId,
      ...payload
    }: {
      modelId: string
      recordType: BimLinkRecordType
      recordId: string
      relationType?: BimRelationType
      elementIds?: string[]
      filter?: BimElementFilters
      notes?: string | null
    }) =>
      data<{
        linked: number
        alreadyLinked: number
        recordTitle: string | null
      }>(apiClient.post(`${base(projectId)}/models/${modelId}/links`, payload)),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const useDeleteBimLink = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ modelId, linkId }: { modelId: string; linkId: string }) =>
      data<{ deleted: boolean }>(
        apiClient.delete(`${base(projectId)}/models/${modelId}/links/${linkId}`)
      ),
    onSuccess: () => invalidate(qc, projectId),
  })
}

export const fmtQuantity = (value: number | null | undefined, unit?: string) =>
  value === null || value === undefined || value === 0
    ? '—'
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`

export const fmtBytes = (bytes: number | null | undefined) =>
  !bytes
    ? '—'
    : bytes > 1_000_000
      ? `${(bytes / 1_000_000).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1000))} KB`
