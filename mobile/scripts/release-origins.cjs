/**
 * A release build must know where its server is.
 *
 * Expo inlines EXPO_PUBLIC_* into the bundle at build time, and
 * src/config/env.ts falls back to http://localhost:5000 when the API origin is
 * missing — right for `expo start` on a laptop, and a dead app on every phone
 * if it ships. Origins are fixed per binary (there is no OTA update channel),
 * so the only place to catch a wrong one is the build.
 *
 * app.config.js calls assertReleaseOrigins(process.env) whenever Expo reads the
 * app config: `expo start`, `expo export`, `expo prebuild` and every EAS build.
 * A build counts as a release when EXPO_PUBLIC_ENV is staging or production, or
 * when EAS is building any profile other than development. For a release, the
 * API and web origins must both be set, https, a bare origin, and on a public
 * host — not localhost, a .local name, or a loopback, private, link-local or
 * carrier-grade NAT address that only resolves on someone's desk.
 *
 * Development is untouched: with EXPO_PUBLIC_ENV unset (or local/development)
 * and no EAS release profile, nothing is checked and no variable is needed.
 */

const ENVIRONMENTS = new Set(['local', 'development', 'staging', 'production'])
const RELEASE_ENVIRONMENTS = new Set(['staging', 'production'])
const ORIGIN_KEYS = ['EXPO_PUBLIC_API_ORIGIN', 'EXPO_PUBLIC_WEB_ORIGIN']

const trimmed = (value) => String(value ?? '').trim()

/** Why this config is a release, or null when it is not one. */
const releaseReason = (env) => {
  const name = trimmed(env.EXPO_PUBLIC_ENV)
  if (RELEASE_ENVIRONMENTS.has(name)) return `EXPO_PUBLIC_ENV=${name}`
  const profile = trimmed(env.EAS_BUILD_PROFILE)
  if (profile && profile !== 'development') return `EAS build profile "${profile}"`
  return null
}

const ipv4 = (host) => {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return null
  const octets = match.slice(1).map(Number)
  return octets.every((octet) => octet <= 255) ? octets : null
}

/** A host a phone on the public internet could not reach, or null when it is public. */
const nonPublicHost = (hostname) => {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return 'localhost'
  // A dotless name ("devbox") only resolves on a LAN; IPv6 literals are handled below.
  if (host.endsWith('.local') || host.endsWith('.internal') || (!host.includes('.') && !host.startsWith('['))) {
    return 'a local network name'
  }
  const octets = ipv4(host)
  if (octets) {
    const [a, b] = octets
    if (a === 127) return 'a loopback address'
    if (a === 0) return 'an unspecified address'
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'a private address'
    if (a === 169 && b === 254) return 'a link-local address'
    if (a === 100 && b >= 64 && b <= 127) return 'a carrier-grade NAT address'
    return null
  }
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1)
    if (v6 === '::1' || v6 === '::') return 'a loopback address'
    if (/^f[cd][0-9a-f]{2}:/.test(v6)) return 'a private address'
    if (/^fe[89ab][0-9a-f]:/.test(v6)) return 'a link-local address'
    if (v6.startsWith('::ffff:')) return 'an IPv4-mapped address'
  }
  return null
}

/** The problem with one origin value for a release, or null when it is fine. */
const originProblem = (key, raw) => {
  const value = trimmed(raw)
  if (!value) return `${key} is not set`
  let url
  try {
    url = new URL(value)
  } catch {
    return `${key}="${value}" is not a URL`
  }
  if (url.protocol !== 'https:') return `${key}="${value}" must use https`
  if (url.username || url.password) return `${key}="${value}" must not carry credentials`
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    return `${key}="${value}" must be an origin only (no path, query or fragment)`
  }
  const reason = nonPublicHost(url.hostname)
  if (reason) return `${key}="${value}" points at ${reason}`
  return null
}

/** Every problem with this environment for a build; empty when it may build. */
const collectReleaseOriginProblems = (env = process.env) => {
  const name = trimmed(env.EXPO_PUBLIC_ENV)
  if (name && !ENVIRONMENTS.has(name)) {
    return [`EXPO_PUBLIC_ENV="${name}" must be one of ${[...ENVIRONMENTS].join(', ')}`]
  }
  if (!releaseReason(env)) return []
  return ORIGIN_KEYS.map((key) => originProblem(key, env[key])).filter(Boolean)
}

/** Throws with every problem named when a release build would ship a bad origin. */
const assertReleaseOrigins = (env = process.env) => {
  const problems = collectReleaseOriginProblems(env)
  if (problems.length) {
    const reason = releaseReason(env)
    throw new Error(
      `Release origin check failed${reason ? ` (${reason})` : ''}:\n- ${problems.join('\n- ')}\n` +
        'Set them in the eas.json profile, e.g. EXPO_PUBLIC_API_ORIGIN=https://api.octapm.com.',
    )
  }
}

module.exports = { assertReleaseOrigins, collectReleaseOriginProblems, releaseReason }
