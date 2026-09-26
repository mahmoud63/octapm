/// <reference lib="webworker" />
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { ExpirationPlugin } from 'workbox-expiration'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'

/**
 * OctaPM service worker (OCTA-MOB-PWA-018).
 *
 * - App shell: every built asset is precached, navigations fall back to it.
 * - Files (sheet PDFs, attachments, photo thumbnails): cache-first, so a
 *   sheet opened once — or saved from "Sheets for offline use" — renders
 *   without signal.
 * - API reads: network-first with a short timeout and a same-day fallback,
 *   so lists and records last seen online still open offline.
 * - Push: shows the notification and opens its record on click.
 *
 * Writes never go through here; the app's outbox replays them.
 */

declare let self: ServiceWorkerGlobalScope

export const FILES_CACHE = 'octapm-files'
export const API_CACHE = 'octapm-api'

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/docs/, /^\/uploads\//],
  })
)

const isFileRequest = (pathname: string) =>
  pathname.startsWith('/api/v1/') &&
  (/\/file$/.test(pathname) ||
    /\/thumbnail$/.test(pathname) ||
    /\/attachments\/documents\//.test(pathname) ||
    /\/photos\/[^/]+\/(file|thumbnail)/.test(pathname))

registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.origin === self.location.origin &&
    isFileRequest(url.pathname),
  new CacheFirst({
    cacheName: FILES_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 400,
        maxAgeSeconds: 30 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  })
)

const NEVER_CACHE_API = /^\/api\/v1\/(auth|notifications|billing|search)/

registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.origin === self.location.origin &&
    url.pathname.startsWith('/api/v1/') &&
    !NEVER_CACHE_API.test(url.pathname) &&
    !isFileRequest(url.pathname),
  new NetworkFirst({
    cacheName: API_CACHE,
    networkTimeoutSeconds: 8,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 400,
        maxAgeSeconds: 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  })
)

interface PushPayload {
  title?: string
  body?: string
  url?: string
  tag?: string
  category?: string
  priority?: string
  notificationId?: string
}

const parsePayload = (data: PushMessageData | null): PushPayload => {
  if (!data) return {}
  try {
    return data.json() as PushPayload
  } catch {
    return { title: 'OctaPM', body: data.text() }
  }
}

self.addEventListener('push', (event) => {
  const payload = parsePayload(event.data)
  const title = payload.title || 'OctaPM'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      tag: payload.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url || '/', notificationId: payload.notificationId },
      // Assignments and mentions should get through; the rest can be quiet.
      silent: payload.priority === 'low',
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(
    (event.notification.data as { url?: string } | undefined)?.url || '/',
    self.location.origin
  ).href
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((client) => 'focus' in client)
        if (existing) {
          return existing.focus().then((client) => {
            if ('navigate' in client) return client.navigate(target)
            return client
          })
        }
        return self.clients.openWindow(target)
      })
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
  // A workspace switch drops the API read cache (workspace switching doc §4,
  // rule 6): the cache is keyed by URL, and the same `/api/v1/projects` is a
  // different list in each workspace. The page deletes the cache itself as
  // well; the worker doing it too covers a page whose Cache API access is
  // restricted. A stale expiration index entry for a missing response is
  // harmless: workbox skips what it cannot find.
  if (event.data?.type === 'DROP_API_CACHE') {
    event.waitUntil(caches.delete(API_CACHE).catch(() => false))
  }
})
