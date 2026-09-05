import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export type MarkupShapeType =
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'polyline'
  | 'cloud'
  | 'text'
  | 'measure'
  | 'highlight'

export interface MarkupPoint {
  x: number
  y: number
}

export interface MarkupShape {
  id: string
  type: MarkupShapeType
  color: string
  strokeWidth: number
  x?: number
  y?: number
  w?: number
  h?: number
  points?: MarkupPoint[]
  text?: string
  fontSize?: number
  label?: string | null
  fill?: boolean
}

export interface Markup {
  id: string
  projectId: string
  sheetId: string
  sheetRevisionId: string | null
  authorId: string | null
  authorName: string | null
  visibility: 'personal' | 'published'
  name: string | null
  shapes: MarkupShape[]
  shapeCount: number
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  isMine: boolean
  canEdit: boolean
}

export const PIN_RECORD_TYPES = [
  'rfi',
  'defect',
  'photo',
  'ncr',
  'submittal',
  'task',
  'safety_incident',
  'itp',
  'correspondence',
] as const
export type PinRecordType = (typeof PIN_RECORD_TYPES)[number]

export interface Pin {
  id: string
  projectId: string
  sheetId: string
  sheetRevisionId: string | null
  x: number
  y: number
  recordType: PinRecordType
  recordId: string
  recordLabel: string
  label: string | null
  color: string | null
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  record: {
    display: string
    status: string | null
    exists: boolean
    ref?: string | null
    thumbnailUrl?: string | null
    fileUrl?: string | null
  } | null
  recordPath: string | null
  sheet?: { id: string; number: string; title: string }
  sheetPath: string
}

export const markupKeys = {
  markups: (projectId: string, sheetId: string) =>
    ['sheet-markups', projectId, sheetId] as const,
  pins: (projectId: string, sheetId: string) =>
    ['sheet-pins', projectId, sheetId] as const,
  recordPins: (projectId: string, recordType: string, recordId: string) =>
    ['record-pins', projectId, recordType, recordId] as const,
}

export const useSheetMarkups = (
  projectId: string,
  sheetId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery<{ items: Markup[] }>({
    queryKey: markupKeys.markups(projectId, sheetId),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: { items: Markup[] } }>(
        `/projects/${projectId}/drawings/sheets/${sheetId}/markups`
      )
      return data.data
    },
    enabled: (options.enabled ?? true) && Boolean(projectId && sheetId),
  })

export const useSaveMyMarkup = (projectId: string, sheetId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      shapes: MarkupShape[]
      name?: string | null
      sheetRevisionId?: string | null
    }) => {
      const { data } = await apiClient.put<{ data: Markup }>(
        `/projects/${projectId}/drawings/sheets/${sheetId}/markups/mine`,
        input
      )
      return data.data
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<{ items: Markup[] }>(
        markupKeys.markups(projectId, sheetId),
        (current) => {
          if (!current) return { items: [saved] }
          const exists = current.items.some((item) => item.id === saved.id)
          return {
            items: exists
              ? current.items.map((item) =>
                  item.id === saved.id ? saved : item
                )
              : [...current.items, saved],
          }
        }
      )
    },
  })
}

export const usePublishMarkup = (projectId: string, sheetId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      markupId,
      name,
    }: {
      markupId: string
      name?: string | null
    }) => {
      const { data } = await apiClient.post<{ data: Markup }>(
        `/projects/${projectId}/drawings/sheets/${sheetId}/markups/${markupId}/publish`,
        { name }
      )
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: markupKeys.markups(projectId, sheetId),
      })
      queryClient.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useDeleteMarkup = (projectId: string, sheetId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (markupId: string) => {
      const { data } = await apiClient.delete<{
        data: { deleted: boolean; id: string }
      }>(
        `/projects/${projectId}/drawings/sheets/${sheetId}/markups/${markupId}`
      )
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: markupKeys.markups(projectId, sheetId),
      })
      queryClient.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const useSheetPins = (
  projectId: string,
  sheetId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery<{ items: Pin[] }>({
    queryKey: markupKeys.pins(projectId, sheetId),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: { items: Pin[] } }>(
        `/projects/${projectId}/drawings/sheets/${sheetId}/pins`
      )
      return data.data
    },
    enabled: (options.enabled ?? true) && Boolean(projectId && sheetId),
  })

export interface CreatePinInput {
  x: number
  y: number
  recordType: PinRecordType
  recordId?: string | null
  create?: Record<string, unknown> | null
  sheetRevisionId?: string | null
  label?: string | null
  color?: string | null
}

export const useCreatePin = (projectId: string, sheetId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreatePinInput) => {
      const { data } = await apiClient.post<{
        data: { pin: Pin; created: { id: string; ref: string | null } | null }
      }>(`/projects/${projectId}/drawings/sheets/${sheetId}/pins`, input)
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: markupKeys.pins(projectId, sheetId),
      })
      queryClient.invalidateQueries({ queryKey: ['record-pins', projectId] })
      queryClient.invalidateQueries({ queryKey: ['audit-events', projectId] })
      // A pin may have created an RFI / defect: refresh the module lists too.
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey[1] === projectId,
      })
    },
  })
}

export const useDeletePin = (projectId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (pinId: string) => {
      const { data } = await apiClient.delete<{
        data: { deleted: boolean; id: string }
      }>(`/projects/${projectId}/drawings/pins/${pinId}`)
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sheet-pins', projectId] })
      queryClient.invalidateQueries({ queryKey: ['record-pins', projectId] })
      queryClient.invalidateQueries({ queryKey: ['audit-events', projectId] })
    },
  })
}

export const isPinRecordType = (value: string): value is PinRecordType =>
  (PIN_RECORD_TYPES as readonly string[]).includes(value)

export const useRecordPins = (
  projectId: string,
  recordType: string,
  recordId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery<{ items: Pin[] }>({
    queryKey: markupKeys.recordPins(projectId, recordType, recordId),
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: { items: Pin[] } }>(
        `/projects/${projectId}/drawings/pins`,
        { params: { recordType, recordId } }
      )
      return data.data
    },
    enabled:
      (options.enabled ?? true) &&
      Boolean(projectId && recordId) &&
      isPinRecordType(recordType),
    staleTime: 60_000,
  })
