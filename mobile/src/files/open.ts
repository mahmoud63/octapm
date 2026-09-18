/**
 * Opening a file the API guards with the bearer.
 *
 * The API answers a file request with a redirect to a short-lived signed URL.
 * That first request needs the access token, so a plain link cannot be used.
 * On the web target the bytes are fetched and opened in a new tab; on a
 * device they are saved to the app's cache and handed to the system's viewer
 * or share sheet. Nothing is kept beyond the cache, and the bearer is never
 * forwarded to the signed URL.
 */
import { Platform } from 'react-native'
import { AppError, fromStatus } from '@/api/errors'
import { network } from '@/api/network'
import { useAuthStore } from '@/auth/store'
import { env } from '@/config/env'

const authHeaders = () => {
  const token = useAuthStore.getState().accessToken
  if (!token) throw new AppError('AUTH_REQUIRED')
  return { Authorization: `Bearer ${token}`, 'X-OctaPM-Client': 'mobile' }
}

/** Open the file at an API path (e.g. `/projects/:id/attachments/documents/:documentId`). */
export async function openApiFile(apiPath: string, fileName = 'file'): Promise<void> {
  if (network.isKnownOffline()) throw new AppError('OFFLINE')
  const url = `${env.apiBase}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`

  if (Platform.OS === 'web') {
    const response = await fetch(url, { headers: authHeaders() })
    if (!response.ok) throw fromStatus(response.status, await response.json().catch(() => null), response.headers.get('x-request-id'))
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    globalThis.open(objectUrl, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    return
  }

  // Native-only modules, loaded here so the web bundle never evaluates them.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sharing = require('expo-sharing') as typeof import('expo-sharing')
  const safeName = fileName.replace(/[^\w.-]+/g, '_')
  const target = `${FileSystem.cacheDirectory ?? ''}${Date.now()}-${safeName}`
  const result = await FileSystem.downloadAsync(url, target, { headers: authHeaders() })
  if (result.status >= 400) throw fromStatus(result.status, undefined, null)
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(result.uri)
}
