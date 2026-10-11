/**
 * OctaPM's canonical hosts, as the web app sees them — the frontend's one
 * place for them (docs/platform/OCTAPM_DOMAIN_ARCHITECTURE.md).
 *
 *   public  octapm.com          VITE_PUBLIC_SITE_URL  marketing site
 *   app     app.octapm.com      VITE_APP_URL          the customer application
 *   portal  portal.octapm.com   VITE_PORTAL_URL       external collaboration (consultants, project parties)
 *   admin   admin.octapm.com    VITE_ADMIN_URL        OctaPM platform administration
 *   market  market.octapm.com   VITE_MARKET_URL       OctaMarket (its own product)
 *
 * The host only chooses the experience (which shell, which routes). It never
 * grants anything: every API call is authorized by the server, whatever host
 * the page was loaded from.
 *
 * `combined` is today's single frontend serving everything: plain
 * http://localhost:5300, or a build with none of the URLs configured. Locally,
 * http://portal.localhost:5300 and http://admin.localhost:5300 preview the
 * portal and admin shells (browsers resolve *.localhost to this machine).
 */

export type Surface = 'public' | 'app' | 'portal' | 'admin' | 'market'
export type SurfaceMode = Surface | 'combined'

const ORDER: Surface[] = ['admin', 'portal', 'app', 'public', 'market']

const originOf = (value: string | undefined): string | null => {
  const raw = (value || '').trim()
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

// Build-time values; absent outside a Vite build (the source checks run this file in Node).
const ENV: Partial<ImportMetaEnv> = import.meta.env ?? {}

/** The configured origin of each surface (build-time, VITE_*). */
export const SURFACE_URLS: Record<Surface, string | null> = {
  public: originOf(ENV.VITE_PUBLIC_SITE_URL),
  app: originOf(ENV.VITE_APP_URL),
  portal: originOf(ENV.VITE_PORTAL_URL),
  admin: originOf(ENV.VITE_ADMIN_URL),
  market: originOf(ENV.VITE_MARKET_URL),
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** A development host: localhost, a loopback address, or *.localhost / *.test. */
export const isLocalHostname = (hostname: string) =>
  LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.test')

const LOCAL_PREFIXES: Surface[] = ['admin', 'portal', 'app']

/**
 * Which surface a page location belongs to.
 *   - a development host: `admin.` / `portal.` / `app.` + localhost choose that
 *     surface, anything else is `combined`;
 *   - no surface URL configured at all (a single-host build): `combined`;
 *   - a configured surface's exact origin: that surface;
 *   - any other host: `app` — an unknown hostname never receives the admin or
 *     the portal shell (domain architecture §36).
 */
export function resolveSurface(
  location: { hostname: string; origin: string },
  urls: Record<Surface, string | null> = SURFACE_URLS
): SurfaceMode {
  if (isLocalHostname(location.hostname)) {
    const prefix = LOCAL_PREFIXES.find((surface) =>
      location.hostname.startsWith(`${surface}.`)
    )
    return prefix ?? 'combined'
  }
  if (!ORDER.some((surface) => urls[surface])) return 'combined'
  return ORDER.find((surface) => urls[surface] === location.origin) ?? 'app'
}

export const currentSurface = (): SurfaceMode =>
  typeof window === 'undefined' ? 'combined' : resolveSurface(window.location)

/** Whether the page is the given surface (`combined` counts as every one). */
export const onSurface = (surface: Surface) => {
  const mode = currentSurface()
  return mode === 'combined' || mode === surface
}

/**
 * The address of a path on another surface: absolute when that surface has a
 * host of its own (another origin), otherwise the path itself.
 */
export function surfaceHref(
  target: Surface,
  path = '/',
  urls: Record<Surface, string | null> = SURFACE_URLS
): string {
  const location = typeof window === 'undefined' ? null : window.location
  if (!location) return path
  let base: string | null = urls[target]
  if (isLocalHostname(location.hostname)) {
    // Local previews: admin.localhost ↔ portal.localhost ↔ localhost (app).
    const mode = resolveSurface(location, urls)
    if (mode === 'combined') return path
    const host = target === 'app' || target === 'public' ? 'localhost' : `${target}.localhost`
    base = `${location.protocol}//${host}${location.port ? `:${location.port}` : ''}`
  }
  if (!base || base === location.origin) return path
  return `${base}${path}`
}

/**
 * A same-application path from untrusted input (a `redirect`, `next`, a
 * notification or push link), or null: one leading slash, never `//host`,
 * `/\host`, a scheme or a control character (open-redirect protection).
 */
export function safeInternalPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(path) || path.length > 2000) return null
  return path
}

/** Routes every surface serves: signing in, recovering an account, errors, legal pages. */
const SHARED_PREFIXES = [
  '/sign-in',
  '/forgot-password',
  '/reset-password',
  '/otp',
  '/sso/complete',
  '/401',
  '/403',
  '/404',
  '/500',
  '/503',
  '/privacy',
  '/terms',
]

/** The public site's own pages. */
const PUBLIC_PAGES = ['/landing', '/privacy', '/terms']

const matches = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`)

export type SurfaceDecision =
  | { kind: 'allow' }
  | { kind: 'path'; to: string }
  | { kind: 'surface'; surface: Surface; to: string }

// The customer application's workspace pages an external party has no use
// for on the portal (each is still authorized by the API wherever it is opened).
const PORTAL_WORKSPACE_PAGES = new Set(['projects', 'settings', 'help-center'])

/**
 * Which routes a surface serves (domain architecture §13): the admin host only
 * the platform console, the portal the external-party project and review
 * pages, the public site the marketing pages. Everything else is sent to the
 * surface it belongs to. A redirect is a convenience, not a control.
 */
export function routeForSurface(mode: SurfaceMode, pathname: string): SurfaceDecision {
  if (mode === 'combined') return { kind: 'allow' }
  const platform = matches(pathname, '/platform-admin')
  if (mode === 'public') {
    // octapm.com is the marketing site: signing in, invitations and every
    // application page belong to app.octapm.com (domain architecture §11).
    if (pathname === '/') return { kind: 'path', to: '/landing' }
    if (PUBLIC_PAGES.some((prefix) => matches(pathname, prefix))) return { kind: 'allow' }
    return { kind: 'surface', surface: platform ? 'admin' : 'app', to: pathname }
  }
  if (SHARED_PREFIXES.some((prefix) => matches(pathname, prefix))) return { kind: 'allow' }

  switch (mode) {
    case 'admin':
      return platform ? { kind: 'allow' } : { kind: 'path', to: '/platform-admin' }
    case 'portal': {
      if (platform) return { kind: 'surface', surface: 'admin', to: pathname }
      if (matches(pathname, '/landing')) return { kind: 'path', to: '/' }
      const workspace = /^\/o\/([^/]+)(?:\/([^/]+))?/.exec(pathname)
      if (workspace && workspace[2] && !PORTAL_WORKSPACE_PAGES.has(workspace[2])) {
        return { kind: 'path', to: `/o/${workspace[1]}` }
      }
      return { kind: 'allow' }
    }
    case 'app':
      return platform ? { kind: 'surface', surface: 'admin', to: pathname } : { kind: 'allow' }
    case 'market':
      // OctaMarket is its own application; this bundle has nothing to serve there.
      return { kind: 'surface', surface: 'public', to: '/' }
  }
}

/** Search engines index the public site only (domain architecture §31). */
export const shouldIndex = (mode: SurfaceMode, pathname: string) =>
  mode === 'public' ||
  (mode === 'combined' && PUBLIC_PAGES.some((prefix) => matches(pathname, prefix)))
