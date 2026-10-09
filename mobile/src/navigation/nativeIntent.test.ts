/**
 * Links the system routes to the app (owner decision Q14): Android claims
 * only the paths the link resolver opens, and a web link the app has no
 * screen for goes to the browser whole instead of being dropped on Home.
 * The app's own native intent handler is exercised directly; the Android
 * claim is read from app.json, which is what prebuild writes the manifest from.
 */
import * as WebBrowser from 'expo-web-browser'
import appConfig from '../../app.json'
import { redirectSystemPath } from '../../app/+native-intent'
import { env } from '@/config/env'
import { resolveLink } from './deepLinks'

const P = 'a2153ef4-0bbb-4b9a-875c-44a0f69f9a12'
const opened = WebBrowser.openBrowserAsync as jest.Mock

interface IntentData {
  scheme?: string
  host?: string
  path?: string
  pathPrefix?: string
  pathPattern?: string
}
interface IntentFilter {
  action: string
  autoVerify?: boolean
  data: IntentData[]
  category: string[]
}

const filters = (appConfig.expo.android as unknown as { intentFilters: IntentFilter[] }).intentFilters
const httpsData = filters.flatMap((f) => f.data).filter((d) => d.scheme === 'https')

/**
 * Whether one <data> element claims a path. Android's simple glob makes `.*`
 * stop at the next literal character; a greedy regex claims at least as much,
 * so "never claimed" here is never claimed on a device.
 */
const claims = (d: IntentData, path: string): boolean => {
  if (d.path !== undefined) return d.path === path
  if (d.pathPrefix !== undefined) return path.startsWith(d.pathPrefix)
  if (d.pathPattern !== undefined) {
    const source = d.pathPattern.split('.*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
    return new RegExp(`^${source}$`).test(path)
  }
  // A data element with no path attribute claims every path on its host.
  return true
}
const claimedBy = (host: string, path: string) => httpsData.some((d) => d.host === host && claims(d, path))

const HOSTS = ['app.octapm.com', 'octapm.com']

describe('Android link claims (app.json)', () => {
  it('names a path on every https entry and never claims the whole site', () => {
    expect(httpsData.length).toBeGreaterThan(0)
    for (const d of httpsData) {
      expect([d.path, d.pathPrefix, d.pathPattern].filter((v) => v !== undefined)).toHaveLength(1)
      expect(d.pathPrefix).not.toBe('/')
      expect(d.pathPrefix).not.toBe('')
      expect(d.path).not.toBe('/')
      expect(d.pathPattern ?? '').not.toMatch(/^\/?\.\*$/)
    }
    // The verification setting is unchanged.
    expect(filters.every((f) => f.autoVerify === true)).toBe(true)
  })

  it('does not claim the invitation, reset, forgotten-password, sign-in or SSO pages, nor the site root', () => {
    const webOnly = ['/', '/accept-invite', '/reset-password', '/forgot-password', '/sign-in', '/sign-up', '/otp', '/sso/complete', '/sso/', '/o/acme', '/o/acme/accept-invite', '/o/acme/sign-in', '/landing', '/settings/security', '/o/acme/settings']
    for (const host of HOSTS) for (const path of webOnly) expect({ host, path, claimed: claimedBy(host, path) }).toEqual({ host, path, claimed: false })
  })

  it('claims the web record paths the resolver opens, on both hosts', () => {
    const owned = ['/projects', `/projects/${P}/rfi`, `/projects/${P}/quality/defects`, '/tasks', '/inventory', `/o/acme/projects/${P}/rfi`, '/o/acme/projects', '/o/acme/tasks', '/o/acme/inventory']
    for (const host of HOSTS) {
      for (const path of owned) {
        expect({ host, path, claimed: claimedBy(host, path) }).toEqual({ host, path, claimed: true })
        expect(resolveLink(`https://${host}${path}?recordId=r1&source=rfi`)).not.toBeNull()
      }
    }
  })
})

describe('redirectSystemPath', () => {
  let consoleSpies: jest.SpyInstance[] = []

  beforeEach(() => {
    opened.mockClear()
    consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => jest.spyOn(console, method).mockImplementation(() => undefined))
  })

  afterEach(() => {
    // The query can carry a token: nothing of the URL reaches the log.
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toMatch(/secret|ticket-1/)
      spy.mockRestore()
    }
  })

  const handOff = async (url: string) => {
    expect(redirectSystemPath({ path: url, initial: true })).toBe('/')
    await Promise.resolve()
    expect(opened).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledWith(url)
  }

  it('hands an invitation, a password reset and an SSO return to the browser with the whole query, and opens Home', async () => {
    await handOff('https://app.octapm.com/accept-invite?token=inv-secret-1&orgSlug=acme')
    opened.mockClear()
    await handOff('https://octapm.com/reset-password?token=reset-secret-1')
    opened.mockClear()
    await handOff('https://app.octapm.com/sso/complete?ticket=sso-ticket-1')
    opened.mockClear()
    await handOff('https://app.octapm.com/sign-in?ssoError=SSO_USER_NOT_FOUND')
  })

  it('hands a claimed web path the app has no screen for to the browser rather than dropping it', async () => {
    await handOff(`https://app.octapm.com/projects/${P}/cost?recordId=x&source=ipc_certificate`)
  })

  it('hands over links on the build’s own web origin', async () => {
    await handOff(`${env.webOrigin}/accept-invite?token=inv-secret-1`)
  })

  it('keeps everything else in the app: its own records, its scheme, other sites', async () => {
    expect(redirectSystemPath({ path: `https://app.octapm.com/projects/${P}/rfi?recordId=r1&source=rfi`, initial: false })).toBe(`/open?to=%2Frfi%2Fr1&projectId=${P}`)
    expect(redirectSystemPath({ path: 'octapm://rfi/r1', initial: false })).toBe('/rfi/r1')
    expect(redirectSystemPath({ path: 'octapm://not-a-screen?token=inv-secret-1', initial: false })).toBe('/')
    expect(redirectSystemPath({ path: 'https://evil.example/accept-invite?token=inv-secret-1', initial: false })).toBe('/')
    await Promise.resolve()
    expect(opened).not.toHaveBeenCalled()
  })

  it('still opens Home when the browser cannot be opened', async () => {
    opened.mockRejectedValueOnce(new Error('no activity'))
    expect(redirectSystemPath({ path: 'https://app.octapm.com/accept-invite?token=inv-secret-1', initial: true })).toBe('/')
    await Promise.resolve()
    expect(opened).toHaveBeenCalledTimes(1)
  })
})
