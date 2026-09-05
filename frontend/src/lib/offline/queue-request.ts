import axios from 'axios'
import { apiClient } from '@/services/api/client'
import {
  enqueue,
  newClientRequestId,
  resolveTempId,
  type OutboxFile,
  type OutboxItem,
  type QueuedResult,
} from './outbox'

export interface SendOrQueueInput<T> {
  projectId: string
  kind: string
  label: string
  method: OutboxItem['method']
  url: string
  body?: Record<string, unknown> | null
  form?: Record<string, string> | null
  files?: File[] | null
  fileField?: string
  clientRequestId?: string
  tempId?: string | null
  dependsOn?: string | null
  conflict?: OutboxItem['conflict']
  /** Turns the API envelope into the result. */
  parse: (data: unknown) => T
}

const isOffline = () =>
  typeof navigator !== 'undefined' && navigator.onLine === false

const toOutboxFiles = (
  files: File[] | null | undefined,
  field: string
): OutboxFile[] =>
  (files ?? []).map((file) => ({
    field,
    name: file.name,
    type: file.type,
    blob: file,
  }))

/**
 * Sends a write now, or stores it in the outbox when the device is offline,
 * the network fails, or the record it depends on has not been created yet.
 */
export async function sendOrQueue<T>(
  input: SendOrQueueInput<T>
): Promise<T | QueuedResult> {
  const clientRequestId =
    input.clientRequestId ?? newClientRequestId(input.kind)
  const fileField = input.fileField ?? 'files'
  const queue = () =>
    enqueue({
      projectId: input.projectId,
      kind: input.kind,
      label: input.label,
      method: input.method,
      url: input.url,
      body: input.body ?? null,
      form: input.form ?? null,
      files: toOutboxFiles(input.files, fileField),
      clientRequestId,
      tempId: input.tempId ?? null,
      dependsOn: input.dependsOn ?? null,
      conflict: input.conflict ?? null,
    })

  if (input.dependsOn) {
    const resolved = await resolveTempId(input.dependsOn).catch(() => null)
    if (!resolved) return queue()
  }
  if (isOffline()) return queue()

  try {
    let response
    if (input.form || input.files?.length) {
      const form = new FormData()
      for (const [key, value] of Object.entries(input.form ?? {}))
        form.append(key, value)
      for (const file of input.files ?? []) form.append(fileField, file)
      response = await apiClient.request({
        method: input.method,
        url: input.url,
        data: form,
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      })
    } else {
      response = await apiClient.request({
        method: input.method,
        url: input.url,
        data: input.body ?? {},
      })
    }
    return input.parse(response.data)
  } catch (error) {
    if (axios.isAxiosError(error) && !error.response) return queue()
    throw error
  }
}
