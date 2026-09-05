import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * Custom fields, fieldsets and record types (OCTA-PLAT-FIELDS-025).
 *
 * Definitions live in the company library (`projectId: null`, shown on every
 * project) or on one project. Values are read and written per record; the
 * server validates them against the schema that applies to the record.
 */

export type CustomFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'money'
  | 'date'
  | 'boolean'
  | 'select'
  | 'multi_select'
  | 'user'
  | 'company'
  | 'url'

export const FIELD_TYPE_LABEL: Record<CustomFieldType, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  money: 'Money',
  date: 'Date',
  boolean: 'Yes / no',
  select: 'Pick one',
  multi_select: 'Pick many',
  user: 'Person',
  company: 'Company',
  url: 'Link',
}

export const CONDITION_OPS = [
  { id: 'eq', label: 'equals', needsValue: true },
  { id: 'neq', label: 'does not equal', needsValue: true },
  { id: 'gt', label: 'greater than', needsValue: true },
  { id: 'gte', label: 'at least', needsValue: true },
  { id: 'lt', label: 'less than', needsValue: true },
  { id: 'lte', label: 'at most', needsValue: true },
  { id: 'in', label: 'is one of', needsValue: true },
  { id: 'nin', label: 'is none of', needsValue: true },
  { id: 'contains', label: 'contains', needsValue: true },
  { id: 'is_true', label: 'is yes', needsValue: false },
  { id: 'is_false', label: 'is no', needsValue: false },
  { id: 'empty', label: 'is empty', needsValue: false },
  { id: 'not_empty', label: 'is set', needsValue: false },
] as const
export type ConditionOp = (typeof CONDITION_OPS)[number]['id']

export interface CustomFieldOption {
  value: string
  label: string
}

export interface CustomFieldCondition {
  field: string
  op: ConditionOp
  value: unknown
}

export interface CustomFieldValidation {
  min?: number | string | null
  max?: number | string | null
  minLength?: number | null
  maxLength?: number | null
  pattern?: string | null
}

export type CustomFieldValue = string | number | boolean | string[] | null

export type CustomFieldValues = Record<string, CustomFieldValue>

export interface CustomFieldSchemaField {
  id: string
  key: string
  label: string
  description: string | null
  type: CustomFieldType
  options: CustomFieldOption[] | null
  required: boolean
  hidden: boolean
  default: CustomFieldValue
  validation: CustomFieldValidation | null
  condition: CustomFieldCondition | null
  position: number
  scope: 'company' | 'project'
}

export interface CustomFieldDefinition extends CustomFieldSchemaField {
  projectId: string | null
  recordType: string
  recordTypeLabel: string
  status: 'active' | 'archived'
  valueCount: number | null
  createdAt: string | null
  updatedAt: string | null
}

export interface CustomFieldDefinitionInput {
  recordType?: string
  key?: string | null
  label?: string
  description?: string | null
  type?: CustomFieldType
  options?: Array<CustomFieldOption | string> | null
  required?: boolean
  hidden?: boolean
  default?: CustomFieldValue
  validation?: CustomFieldValidation | null
  condition?: CustomFieldCondition | null
  position?: number
  status?: 'active' | 'archived'
}

export interface CustomFieldsetEntry {
  fieldId: string
  required: boolean | null
  hidden: boolean | null
  position: number
}

export interface CustomFieldset {
  id: string
  recordType: string
  recordTypeLabel: string
  name: string
  description: string | null
  isDefault: boolean
  fields: CustomFieldsetEntry[]
  status: 'active' | 'archived'
  projectCount: number | null
}

export interface CustomFieldsetInput {
  recordType?: string
  name?: string
  description?: string | null
  isDefault?: boolean
  fields?: Array<Partial<CustomFieldsetEntry> & { fieldId: string }>
  status?: 'active' | 'archived'
}

export interface RecordTypeDefinition {
  id: string
  tool: string
  toolLabel: string
  key: string
  label: string
  description: string | null
  fieldsetId: string | null
  fieldset: { id: string; name: string } | null
  settings: { defaults?: Record<string, unknown> }
  position: number
  status: 'active' | 'archived'
}

export interface RecordTypeInput {
  tool?: string
  key?: string | null
  label?: string
  description?: string | null
  fieldsetId?: string | null
  settings?: { defaults?: Record<string, unknown> } | null
  position?: number
  status?: 'active' | 'archived'
}

export interface CustomFieldRecordType {
  key: string
  label: string
  module: string
  supportsRecordTypes: boolean
  fieldCount: number
}

export interface CustomFieldSchema {
  recordType: string
  recordTypeLabel: string
  module: string
  fields: CustomFieldSchemaField[]
  fieldset: { id: string; name: string } | null
  recordTypeDefinition: RecordTypeDefinition | null
}

export interface CustomFieldValuesResponse extends CustomFieldSchema {
  values: CustomFieldValues
}

export interface ProjectFieldsetAssignment {
  recordType: string
  recordTypeLabel: string
  fieldsetId: string
  fieldset: { id: string; name: string; status: string } | null
}

const rootKey = ['custom-fields'] as const
const scopeKey = (projectId: string | null) => projectId ?? 'company'

const definitionsBase = (projectId: string | null) =>
  projectId
    ? `/projects/${projectId}/custom-fields/definitions`
    : '/company/custom-fields'

const invalidateAll = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: rootKey })

export const useCustomFieldRecordTypes = (
  projectId: string | null,
  options: { enabled?: boolean } = {}
) =>
  useQuery<{
    recordTypes: CustomFieldRecordType[]
    fieldTypes: CustomFieldType[]
    definitions?: RecordTypeDefinition[]
  }>({
    queryKey: [...rootKey, 'record-types', scopeKey(projectId)],
    queryFn: () =>
      apiClient
        .get(
          projectId
            ? `/projects/${projectId}/custom-fields/record-types`
            : '/company/custom-fields/record-types'
        )
        .then((response) => response.data.data),
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  })

export const useCustomFieldDefinitions = (
  projectId: string | null,
  query: { recordType?: string | null; includeArchived?: boolean } = {},
  options: { enabled?: boolean } = {}
) =>
  useQuery<CustomFieldDefinition[]>({
    queryKey: [...rootKey, 'definitions', scopeKey(projectId), query],
    queryFn: () =>
      apiClient
        .get(definitionsBase(projectId), {
          params: {
            ...(query.recordType ? { recordType: query.recordType } : {}),
            ...(query.includeArchived ? { includeArchived: true } : {}),
          },
        })
        .then(
          (response) => response.data.data.items as CustomFieldDefinition[]
        ),
    enabled: options.enabled ?? true,
  })

export const useSaveCustomFieldDefinition = (projectId: string | null) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      definitionId,
      payload,
    }: {
      definitionId?: string | null
      payload: CustomFieldDefinitionInput
    }) =>
      (definitionId
        ? apiClient.patch(
            `${definitionsBase(projectId)}/${definitionId}`,
            payload
          )
        : apiClient.post(definitionsBase(projectId), payload)
      ).then((response) => response.data.data as CustomFieldDefinition),
    onSuccess: () => invalidateAll(qc),
  })
}

export const useArchiveCustomFieldDefinition = (projectId: string | null) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (definitionId: string) =>
      apiClient
        .delete(`${definitionsBase(projectId)}/${definitionId}`)
        .then((response) => response.data.data as CustomFieldDefinition),
    onSuccess: () => invalidateAll(qc),
  })
}

export const useCustomFieldsets = (
  projectId: string | null,
  query: { recordType?: string | null; includeArchived?: boolean } = {},
  options: { enabled?: boolean } = {}
) =>
  useQuery<CustomFieldset[]>({
    queryKey: [...rootKey, 'fieldsets', scopeKey(projectId), query],
    queryFn: () =>
      apiClient
        .get(
          projectId
            ? `/projects/${projectId}/custom-fields/fieldsets`
            : '/company/custom-fieldsets',
          {
            params: {
              ...(query.recordType ? { recordType: query.recordType } : {}),
              ...(query.includeArchived && !projectId
                ? { includeArchived: true }
                : {}),
            },
          }
        )
        .then((response) => response.data.data.items as CustomFieldset[]),
    enabled: options.enabled ?? true,
  })

export const useSaveCustomFieldset = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      fieldsetId,
      payload,
    }: {
      fieldsetId?: string | null
      payload: CustomFieldsetInput
    }) =>
      (fieldsetId
        ? apiClient.patch(`/company/custom-fieldsets/${fieldsetId}`, payload)
        : apiClient.post('/company/custom-fieldsets', payload)
      ).then((response) => response.data.data as CustomFieldset),
    onSuccess: () => invalidateAll(qc),
  })
}

export const useArchiveCustomFieldset = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fieldsetId: string) =>
      apiClient
        .delete(`/company/custom-fieldsets/${fieldsetId}`)
        .then((response) => response.data.data as CustomFieldset),
    onSuccess: () => invalidateAll(qc),
  })
}

export const useRecordTypes = (
  tool: string | null = null,
  options: { enabled?: boolean; includeArchived?: boolean } = {}
) =>
  useQuery<{ items: RecordTypeDefinition[]; tools: string[] }>({
    queryKey: [
      ...rootKey,
      'record-type-definitions',
      tool ?? 'all',
      options.includeArchived ?? false,
    ],
    queryFn: () =>
      apiClient
        .get('/company/record-types', {
          params: {
            ...(tool ? { tool } : {}),
            ...(options.includeArchived ? { includeArchived: true } : {}),
          },
        })
        .then((response) => response.data.data),
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  })

export const useSaveRecordType = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      recordTypeId,
      payload,
    }: {
      recordTypeId?: string | null
      payload: RecordTypeInput
    }) =>
      (recordTypeId
        ? apiClient.patch(`/company/record-types/${recordTypeId}`, payload)
        : apiClient.post('/company/record-types', payload)
      ).then((response) => response.data.data as RecordTypeDefinition),
    onSuccess: () => invalidateAll(qc),
  })
}

export const useArchiveRecordType = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (recordTypeId: string) =>
      apiClient
        .delete(`/company/record-types/${recordTypeId}`)
        .then((response) => response.data.data as RecordTypeDefinition),
    onSuccess: () => invalidateAll(qc),
  })
}

export const useProjectFieldsets = (projectId: string) =>
  useQuery<ProjectFieldsetAssignment[]>({
    queryKey: [...rootKey, 'assignments', projectId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/custom-fields/assignments`)
        .then(
          (response) => response.data.data.items as ProjectFieldsetAssignment[]
        ),
    enabled: Boolean(projectId),
  })

export const useSetProjectFieldset = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { recordType: string; fieldsetId: string | null }) =>
      apiClient
        .put(`/projects/${projectId}/custom-fields/assignments`, payload)
        .then(
          (response) => response.data.data.items as ProjectFieldsetAssignment[]
        ),
    onSuccess: () => invalidateAll(qc),
  })
}

export const useCustomFieldSchema = (
  projectId: string,
  recordType: string,
  recordTypeKey: string | null = null,
  options: { enabled?: boolean } = {}
) =>
  useQuery<CustomFieldSchema>({
    queryKey: [
      ...rootKey,
      'schema',
      projectId,
      recordType,
      recordTypeKey ?? '',
    ],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/custom-fields/schema`, {
          params: {
            recordType,
            ...(recordTypeKey ? { recordTypeKey } : {}),
          },
        })
        .then((response) => response.data.data as CustomFieldSchema),
    staleTime: 60_000,
    enabled: Boolean(projectId && recordType) && (options.enabled ?? true),
  })

export const useCustomFieldValues = (
  projectId: string,
  recordType: string,
  recordId: string | null,
  recordTypeKey: string | null = null,
  options: { enabled?: boolean } = {}
) =>
  useQuery<CustomFieldValuesResponse>({
    queryKey: [
      ...rootKey,
      'values',
      projectId,
      recordType,
      recordId ?? '',
      recordTypeKey ?? '',
    ],
    queryFn: () =>
      apiClient
        .get(
          `/projects/${projectId}/custom-fields/values/${recordType}/${recordId}`,
          { params: recordTypeKey ? { recordTypeKey } : {} }
        )
        .then((response) => response.data.data as CustomFieldValuesResponse),
    enabled:
      Boolean(projectId && recordType && recordId) && (options.enabled ?? true),
  })

export const useSetCustomFieldValues = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      recordType,
      recordId,
      values,
      recordTypeKey,
      context,
      partial,
    }: {
      recordType: string
      recordId: string
      values: CustomFieldValues
      recordTypeKey?: string | null
      context?: Record<string, unknown>
      partial?: boolean
    }) =>
      apiClient
        .put(
          `/projects/${projectId}/custom-fields/values/${recordType}/${recordId}`,
          {
            values,
            recordTypeKey: recordTypeKey ?? null,
            context: context ?? {},
            partial: Boolean(partial),
          }
        )
        .then((response) => response.data.data as CustomFieldValuesResponse),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({
        queryKey: [...rootKey, 'values', projectId, variables.recordType],
      })
      qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

// ─── helpers shared by the form, the panel and the create dialogs ──────────

const lower = (value: unknown) => String(value ?? '').toLowerCase()

/** Client-side mirror of the server rule so conditional fields show/hide as you type. */
export const evaluateCondition = (
  context: Record<string, unknown>,
  condition: CustomFieldCondition
): boolean => {
  const actual = context[condition.field]
  const value = condition.value
  switch (condition.op) {
    case 'eq':
      return typeof actual === 'number'
        ? actual === Number(value)
        : lower(actual) === lower(value)
    case 'neq':
      return !evaluateCondition(context, { ...condition, op: 'eq' })
    case 'gt':
      return Number(actual) > Number(value)
    case 'gte':
      return Number(actual) >= Number(value)
    case 'lt':
      return Number(actual) < Number(value)
    case 'lte':
      return Number(actual) <= Number(value)
    case 'in':
      return (Array.isArray(value) ? value : String(value ?? '').split(','))
        .map(lower)
        .includes(lower(actual))
    case 'nin':
      return !evaluateCondition(context, { ...condition, op: 'in' })
    case 'contains':
      return lower(actual).includes(lower(value))
    case 'is_true':
      return actual === true
    case 'is_false':
      return actual === false || actual === null || actual === undefined
    case 'empty':
      return (
        actual === null ||
        actual === undefined ||
        actual === '' ||
        (Array.isArray(actual) && actual.length === 0)
      )
    case 'not_empty':
      return !evaluateCondition(context, { ...condition, op: 'empty' })
    default:
      return false
  }
}

export const isBlank = (value: CustomFieldValue | undefined) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0)

/** Fields to show for the current values and record context. */
export const visibleFields = (
  fields: CustomFieldSchemaField[],
  values: CustomFieldValues,
  context: Record<string, unknown> = {}
) => {
  const merged = { ...context, ...values }
  return fields.filter(
    (field) =>
      !field.hidden &&
      (!field.condition || evaluateCondition(merged, field.condition))
  )
}

/** Required fields still blank, by label — checked before a create request. */
export const missingRequired = (
  fields: CustomFieldSchemaField[],
  values: CustomFieldValues,
  context: Record<string, unknown> = {}
) =>
  visibleFields(fields, values, context)
    .filter((field) => field.required && isBlank(values[field.key]))
    .map((field) => field.label)

export const hasAnyValue = (values: CustomFieldValues) =>
  Object.values(values).some((value) => !isBlank(value))

export const formatCustomValue = (
  field: CustomFieldSchemaField,
  value: CustomFieldValue | undefined
) => {
  if (isBlank(value)) return '—'
  if (field.type === 'boolean') return value ? 'Yes' : 'No'
  if (field.type === 'money')
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  if (field.type === 'date') return new Date(String(value)).toLocaleDateString()
  if (field.type === 'select')
    return (
      field.options?.find((option) => option.value === value)?.label ??
      String(value)
    )
  if (field.type === 'multi_select' && Array.isArray(value))
    return value
      .map(
        (item) =>
          field.options?.find((option) => option.value === item)?.label ?? item
      )
      .join(', ')
  return String(value)
}

/** Initial values for a new record: the defaults from the schema. */
export const defaultValues = (fields: CustomFieldSchemaField[]) =>
  Object.fromEntries(
    fields
      .filter((field) => !isBlank(field.default))
      .map((field) => [field.key, field.default])
  ) as CustomFieldValues
