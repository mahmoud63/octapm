/**
 * Server state for the record screens (M2). Every key sits under the
 * project's key, so leaving the project drops it; global tasks sit under
 * their own key and are cleared at sign-out with everything else.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthenticated } from '@/auth/store'
import { keys } from '@/api/query'
import {
  addTaskComment,
  closeTask,
  convertRfiToChange,
  createRfi,
  createTask,
  getCustomFieldSchema,
  getCustomFieldValues,
  getOfflineManifest,
  getRegister,
  getRfi,
  getSheet,
  getTask,
  listActivities,
  listAttachments,
  listComments,
  listHistory,
  listLocations,
  listRfis,
  listSheetPins,
  listSheets,
  listTasks,
  listTeam,
  postComment,
  postRfiResponse,
  runRfiAction,
  updateTask,
  uploadAttachments,
  type AttachmentUpload,
  type RfiFilters,
  type TaskFilters,
} from '@/api/record-endpoints'
import type { RfiAction, RfiCreate, TaskCreate } from '@/api/record-types'

const scoped = (projectId: string, ...rest: readonly unknown[]) => keys.projectScoped(projectId, ...rest)

// ── RFIs ──

export function useRfis(projectId: string | null, filters: RfiFilters = {}) {
  return useQuery({
    queryKey: scoped(projectId ?? 'none', 'rfis', filters),
    queryFn: ({ signal }) => listRfis(projectId!, filters, signal),
    enabled: !!projectId,
    placeholderData: (previous) => previous,
  })
}

export function useRfi(projectId: string | null, rfiId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'rfi', rfiId), queryFn: ({ signal }) => getRfi(projectId!, rfiId!, signal), enabled: !!projectId && !!rfiId })
}

export function useRfiActions(projectId: string) {
  const client = useQueryClient()
  const settle = (rfiId?: string) => {
    void client.invalidateQueries({ queryKey: scoped(projectId, 'rfis') })
    if (rfiId) {
      void client.invalidateQueries({ queryKey: scoped(projectId, 'rfi', rfiId) })
      void client.invalidateQueries({ queryKey: scoped(projectId, 'history', 'rfi', rfiId) })
    }
    void client.invalidateQueries({ queryKey: keys.needsYou(projectId) })
  }
  const create = useMutation({ mutationFn: (body: RfiCreate) => createRfi(projectId, body), onSuccess: () => settle() })
  const respond = useMutation({
    mutationFn: ({ rfiId, body, isOfficial }: { rfiId: string; body: string; isOfficial?: boolean }) => postRfiResponse(projectId, rfiId, { body, isOfficial }),
    onSuccess: (_data, variables) => settle(variables.rfiId),
  })
  const act = useMutation({
    mutationFn: ({ rfiId, action, body }: { rfiId: string; action: RfiAction; body?: Record<string, unknown> }) => runRfiAction(projectId, rfiId, action, body),
    onSuccess: (_data, variables) => settle(variables.rfiId),
  })
  const convert = useMutation({
    mutationFn: ({ rfiId, description, value }: { rfiId: string; description?: string; value?: number }) => convertRfiToChange(projectId, rfiId, { description, value }),
    onSuccess: (_data, variables) => settle(variables.rfiId),
  })
  return { create, respond, act, convert }
}

// ── Tasks ──

export function useTasks(filters: TaskFilters = {}) {
  const authed = useAuthenticated()
  return useQuery({ enabled: authed, queryKey: [...keys.tasks, filters], queryFn: ({ signal }) => listTasks(filters, signal), placeholderData: (previous) => previous })
}

export function useTask(taskId: string | null) {
  return useQuery({ queryKey: keys.task(taskId ?? 'none'), queryFn: ({ signal }) => getTask(taskId!, signal), enabled: !!taskId })
}

export function useTaskActions() {
  const client = useQueryClient()
  const settle = (taskId?: string) => {
    void client.invalidateQueries({ queryKey: keys.tasks })
    if (taskId) void client.invalidateQueries({ queryKey: keys.task(taskId) })
  }
  const create = useMutation({ mutationFn: (body: TaskCreate) => createTask(body), onSuccess: () => settle() })
  const update = useMutation({ mutationFn: ({ taskId, body }: { taskId: string; body: Partial<TaskCreate> }) => updateTask(taskId, body), onSuccess: (_d, v) => settle(v.taskId) })
  const close = useMutation({ mutationFn: ({ taskId, comment }: { taskId: string; comment?: string }) => closeTask(taskId, comment), onSuccess: (_d, v) => settle(v.taskId) })
  const comment = useMutation({ mutationFn: ({ taskId, body }: { taskId: string; body: string }) => addTaskComment(taskId, body), onSuccess: (_d, v) => settle(v.taskId) })
  return { create, update, close, comment }
}

// ── Comments, history, attachments, custom fields ──

export function useComments(projectId: string | null, recordType: string, recordId: string | null) {
  return useQuery({
    queryKey: scoped(projectId ?? 'none', 'comments', recordType, recordId),
    queryFn: ({ signal }) => listComments(projectId!, recordType, recordId!, signal),
    enabled: !!projectId && !!recordId,
    select: (page) => page.items,
  })
}

export function usePostComment(projectId: string, recordType: string, recordId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => postComment(projectId, { recordType, recordId, body }),
    onSuccess: () => void client.invalidateQueries({ queryKey: scoped(projectId, 'comments', recordType, recordId) }),
  })
}

export function useHistory(projectId: string | null, entityType: string, entityId: string | null) {
  return useQuery({
    queryKey: scoped(projectId ?? 'none', 'history', entityType, entityId),
    queryFn: ({ signal }) => listHistory(projectId!, entityType, entityId!, signal),
    enabled: !!projectId && !!entityId,
    select: (page) => page.events,
  })
}

export function useAttachments(projectId: string | null, recordType: string, recordId: string | null) {
  return useQuery({
    queryKey: scoped(projectId ?? 'none', 'attachments', recordType, recordId),
    queryFn: ({ signal }) => listAttachments(projectId!, recordType, recordId!, signal),
    enabled: !!projectId && !!recordId,
    select: (data) => data.items,
  })
}

export function useUploadAttachments(projectId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (upload: AttachmentUpload) => uploadAttachments(projectId, upload),
    onSuccess: (_data, upload) => {
      void client.invalidateQueries({ queryKey: scoped(projectId, 'attachments', upload.recordType, upload.recordId) })
      void client.invalidateQueries({ queryKey: scoped(projectId, upload.recordType, upload.recordId) })
    },
  })
}

export function useCustomFields(projectId: string | null, recordType: string, recordId: string | null) {
  const schema = useQuery({ queryKey: scoped(projectId ?? 'none', 'custom-fields', recordType), queryFn: ({ signal }) => getCustomFieldSchema(projectId!, recordType, signal), enabled: !!projectId, staleTime: 10 * 60_000 })
  const values = useQuery({
    queryKey: scoped(projectId ?? 'none', 'custom-fields', recordType, recordId),
    queryFn: ({ signal }) => getCustomFieldValues(projectId!, recordType, recordId!, signal),
    enabled: !!projectId && !!recordId && (schema.data?.fields.length ?? 0) > 0,
  })
  return { fields: schema.data?.fields ?? [], values: values.data?.values ?? {}, isLoading: schema.isPending }
}

// ── Pickers ──

export function useTeam(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'team'), queryFn: ({ signal }) => listTeam(projectId!, signal), enabled: !!projectId, select: (d) => d.items.filter((m) => m.status === 'active'), staleTime: 10 * 60_000 })
}

export function useLocations(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'locations'), queryFn: ({ signal }) => listLocations(projectId!, signal), enabled: !!projectId, select: (d) => d.items.filter((l) => l.status !== 'archived'), staleTime: 10 * 60_000 })
}

export function useActivities(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'activities'), queryFn: ({ signal }) => listActivities(projectId!, signal), enabled: !!projectId, staleTime: 10 * 60_000 })
}

// ── Documents and drawings ──

export function useRegister(projectId: string | null, filters: { folder?: string; search?: string } = {}) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'register', filters), queryFn: ({ signal }) => getRegister(projectId!, filters, signal), enabled: !!projectId, placeholderData: (previous) => previous })
}

export function useSheets(projectId: string | null, filters: { search?: string; discipline?: string; status?: 'current' | 'obsolete' | 'all'; locationId?: string } = {}) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'sheets', filters), queryFn: ({ signal }) => listSheets(projectId!, filters, signal), enabled: !!projectId, placeholderData: (previous) => previous })
}

export function useSheet(projectId: string | null, sheetId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'sheet', sheetId), queryFn: ({ signal }) => getSheet(projectId!, sheetId!, signal), enabled: !!projectId && !!sheetId })
}

export function useOfflineManifest(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'sheets', 'manifest'), queryFn: ({ signal }) => getOfflineManifest(projectId!, signal), enabled: !!projectId })
}

export function useSheetPins(projectId: string | null, sheetId: string | null) {
  return useQuery({
    queryKey: scoped(projectId ?? 'none', 'sheet', sheetId, 'pins'),
    queryFn: ({ signal }) => listSheetPins(projectId!, sheetId!, signal),
    enabled: !!projectId && !!sheetId,
    select: (data) => (Array.isArray(data) ? data : data.items),
  })
}
