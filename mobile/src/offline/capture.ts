/**
 * Send now, or keep for later. A screen that captures a replay-safe write
 * calls this instead of the endpoint: online, the write goes straight
 * through and the screen behaves as before; offline, or when the send is
 * lost before a reply, the write is queued with the same replay key and the
 * screen tells the person it will go when the signal returns.
 */
import { Platform } from 'react-native'
import { isAppError } from '@/api/errors'
import { network } from '@/api/network'
import { enqueue, type EnqueueInput, type OutboxItem } from '@/offline/outbox'
import type { QueuedFile } from '@/offline/senders'
import { log } from '@/utilities/logger'

export type CaptureResult<T> = { sent: T; queued?: undefined } | { queued: OutboxItem; sent?: undefined }

export async function captureOrQueue<T>(input: EnqueueInput, send: () => Promise<T>): Promise<CaptureResult<T>> {
  if (network.isKnownOffline()) return { queued: await enqueue(input) }
  try {
    return { sent: await send() }
  } catch (error) {
    // A lost connection or a lost reply: the replay key makes a later send safe.
    if (isAppError(error) && (error.code === 'OFFLINE' || error.code === 'TIMEOUT')) {
      log.info('sync', `queued after ${error.code}`, { kind: input.kind })
      return { queued: await enqueue(input) }
    }
    throw error
  }
}

/**
 * Files chosen from the camera or the library live in a temporary folder
 * the platform may clear; a queued upload copies them into the app's own
 * documents first. On the web target the picker's data URL is kept as is.
 */
export async function keepFilesForQueue(files: QueuedFile[]): Promise<QueuedFile[]> {
  if (Platform.OS === 'web') return files
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FileSystem = require('expo-file-system/legacy') as { documentDirectory: string | null; makeDirectoryAsync: (uri: string, o: { intermediates: boolean }) => Promise<void>; copyAsync: (o: { from: string; to: string }) => Promise<void> }
  const dir = `${FileSystem.documentDirectory ?? ''}outbox/`
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined)
  const kept: QueuedFile[] = []
  for (const file of files) {
    const to = `${dir}${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`
    await FileSystem.copyAsync({ from: file.uri, to })
    kept.push({ ...file, uri: to })
  }
  return kept
}
