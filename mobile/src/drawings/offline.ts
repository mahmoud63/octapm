/**
 * Sheets kept on the device, and the one rule that matters for them: a
 * kept copy is never shown as current once the server holds a newer
 * revision. The manifest names the current revision of every sheet; a
 * kept sheet whose revision differs is superseded, on the register and in
 * the viewer, until the person keeps the latest.
 */
import { Platform } from 'react-native'
import type { OfflineManifest } from '@/api/record-types'
import { useAuthStore } from '@/auth/store'
import { env } from '@/config/env'
import type { KeptSheet } from '@/drawings/preferences'

export interface KeptState {
  kept: KeptSheet | null
  /** The server's current revision is not the one on the device. */
  superseded: boolean
  latest: { revisionId: string; revision: string } | null
}

export function keptState(sheetId: string, kept: Record<string, KeptSheet>, manifest: OfflineManifest | undefined): KeptState {
  const mine = kept[sheetId] ?? null
  const current = manifest?.items.find((i) => i.sheetId === sheetId) ?? null
  const latest = current ? { revisionId: current.revisionId, revision: current.revision } : null
  return { kept: mine, superseded: !!mine && !!latest && latest.revisionId !== mine.revisionId, latest }
}

/**
 * Copy the sheet's PDF into the app's documents so it opens without a
 * signal. The web target keeps nothing on disk and answers null; the
 * viewer then falls back to the network.
 */
export async function keepSheetFile(apiPath: string, sheetId: string): Promise<string | null> {
  if (Platform.OS === 'web') return null
  const token = useAuthStore.getState().accessToken
  if (!token) return null
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FileSystem = require('expo-file-system/legacy') as { documentDirectory: string | null; makeDirectoryAsync: (uri: string, o: { intermediates: boolean }) => Promise<void>; downloadAsync: (url: string, target: string, o: { headers: Record<string, string> }) => Promise<{ status: number; uri: string }>; deleteAsync: (uri: string, o: { idempotent: boolean }) => Promise<void> }
  const dir = `${FileSystem.documentDirectory ?? ''}offline-sheets/`
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined)
  const result = await FileSystem.downloadAsync(`${env.apiBase}${apiPath}`, `${dir}${sheetId}.pdf`, { headers: { Authorization: `Bearer ${token}`, 'X-OctaPM-Client': 'mobile' } })
  if (result.status >= 400) throw new Error(`The sheet could not be downloaded (${result.status}).`)
  return result.uri
}

export async function removeSheetFile(uri: string | null): Promise<void> {
  if (!uri || Platform.OS === 'web') return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FileSystem = require('expo-file-system/legacy') as { deleteAsync: (uri: string, o: { idempotent: boolean }) => Promise<void> }
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
}
