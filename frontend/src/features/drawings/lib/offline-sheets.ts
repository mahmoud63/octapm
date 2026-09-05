import { apiClient } from '@/services/api/client'
import type { OfflineManifest } from '../hooks/use-drawings'

/**
 * Sheets saved for offline use live in the service worker's file cache, so
 * the viewer and thumbnails find them without any special casing: the same
 * URL that the API serves is what the cache answers.
 */

export const FILES_CACHE = 'octapm-files'

export const cachesAvailable = () => typeof caches !== 'undefined'

const cacheKey = (fileUrl: string) =>
  new URL(fileUrl, window.location.origin).href

/** API path (as served in `fileUrl`) → request path for the axios client. */
const toApiPath = (fileUrl: string) => fileUrl.replace(/^\/api\/v1/, '')

export const readCachedFile = async (fileUrl: string) => {
  if (!cachesAvailable()) return null
  const cache = await caches.open(FILES_CACHE)
  const hit = await cache.match(cacheKey(fileUrl))
  return hit ?? null
}

export const isFileCached = async (fileUrl: string) =>
  Boolean(await readCachedFile(fileUrl))

/** Fetches a file with the bearer token and stores it under its public URL. */
export const cacheFile = async (
  fileUrl: string,
  contentType = 'application/pdf'
) => {
  if (!cachesAvailable())
    throw new Error('This browser cannot store files for offline use')
  const response = await apiClient.get<ArrayBuffer>(toApiPath(fileUrl), {
    responseType: 'arraybuffer',
    timeout: 5 * 60 * 1000,
  })
  const cache = await caches.open(FILES_CACHE)
  await cache.put(
    cacheKey(fileUrl),
    new Response(response.data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(response.data.byteLength),
        'X-OctaPM-Cached-At': new Date().toISOString(),
      },
    })
  )
  return response.data.byteLength
}

export interface SaveProgress {
  done: number
  total: number
  bytes: number
  failed: string[]
}

/** Downloads every file of the offline manifest (documents are shared by pages, so each is fetched once). */
export const saveManifestOffline = async (
  manifest: OfflineManifest,
  onProgress?: (progress: SaveProgress) => void
) => {
  const urls = [...new Set(manifest.items.map((item) => item.fileUrl))]
  const progress: SaveProgress = {
    done: 0,
    total: urls.length,
    bytes: 0,
    failed: [],
  }
  for (const url of urls) {
    try {
      progress.bytes += await cacheFile(url)
    } catch {
      progress.failed.push(url)
    }
    progress.done += 1
    onProgress?.({ ...progress })
  }
  return progress
}

export const cachedManifestCount = async (manifest: OfflineManifest) => {
  const urls = [...new Set(manifest.items.map((item) => item.fileUrl))]
  const checks = await Promise.all(urls.map((url) => isFileCached(url)))
  return { cached: checks.filter(Boolean).length, total: urls.length }
}

export const forgetOfflineFiles = async () => {
  if (!cachesAvailable()) return false
  return caches.delete(FILES_CACHE)
}
