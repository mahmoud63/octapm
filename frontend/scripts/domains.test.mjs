/**
 * Host routing for OctaPM's canonical domains (src/lib/domains.ts):
 * which surface a host is, which routes each surface serves, where cross-host
 * links go, and which return paths are accepted (open-redirect protection).
 * The module is transpiled and run, with the VITE_* URLs of a production build.
 */
import assert from 'node:assert/strict'
// Node runs the TypeScript module itself (type stripping); no build step.
import * as m from '../src/lib/domains.ts'

// The URLs of a production build (VITE_*), passed where the module takes them.
const PROD = {
  public: 'https://octapm.com',
  app: 'https://app.octapm.com',
  portal: 'https://portal.octapm.com',
  admin: 'https://admin.octapm.com',
  market: 'https://market.octapm.com',
}
const NONE = { public: null, app: null, portal: null, admin: null, market: null }
const onPage = (url) => {
  globalThis.window = { location: at(url) }
}
const at = (url) => {
  const u = new URL(url)
  return { hostname: u.hostname, origin: u.origin, protocol: u.protocol, port: u.port, pathname: u.pathname, search: u.search }
}

let passed = 0
const check = (name, fn) => {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}


check('each canonical host is its own surface', () => {
  assert.equal(m.resolveSurface(at('https://octapm.com/'), PROD), 'public')
  assert.equal(m.resolveSurface(at('https://app.octapm.com/'), PROD), 'app')
  assert.equal(m.resolveSurface(at('https://portal.octapm.com/'), PROD), 'portal')
  assert.equal(m.resolveSurface(at('https://admin.octapm.com/'), PROD), 'admin')
  assert.equal(m.resolveSurface(at('https://market.octapm.com/'), PROD), 'market')
})

check('an unknown production host never gets the admin or portal shell', () => {
  assert.equal(m.resolveSurface(at('https://admin.evil.example/'), PROD), 'app')
  assert.equal(m.resolveSurface(at('https://www.octapm.com/'), PROD), 'app')
  assert.equal(m.resolveSurface(at('https://admin.octapm.com.evil.example/'), PROD), 'app')
})

check('local development keeps one combined frontend; *.localhost previews a surface', () => {
  assert.equal(m.resolveSurface(at('http://localhost:5300/'), PROD), 'combined')
  assert.equal(m.resolveSurface(at('http://127.0.0.1:5300/'), PROD), 'combined')
  assert.equal(m.resolveSurface(at('http://admin.localhost:5300/'), PROD), 'admin')
  assert.equal(m.resolveSurface(at('http://portal.localhost:5300/'), PROD), 'portal')
})

check('a build with no surface URLs serves everything from one host', () => {
  assert.equal(m.resolveSurface(at('https://octapm.com/'), NONE), 'combined')
})

check('admin host serves only the platform console and the sign-in pages', () => {
  assert.deepEqual(m.routeForSurface('admin', '/platform-admin/companies'), { kind: 'allow' })
  assert.deepEqual(m.routeForSurface('admin', '/sign-in'), { kind: 'allow' })
  assert.deepEqual(m.routeForSurface('admin', '/'), { kind: 'path', to: '/platform-admin' })
  assert.deepEqual(m.routeForSurface('admin', '/o/acme/projects'), { kind: 'path', to: '/platform-admin' })
  assert.deepEqual(m.routeForSurface('admin', '/accept-invite'), { kind: 'path', to: '/platform-admin' })
})

check('app and portal hosts send the platform console to the admin host', () => {
  assert.deepEqual(m.routeForSurface('app', '/platform-admin'), { kind: 'surface', surface: 'admin', to: '/platform-admin' })
  assert.deepEqual(m.routeForSurface('portal', '/platform-admin/users'), { kind: 'surface', surface: 'admin', to: '/platform-admin/users' })
  assert.deepEqual(m.routeForSurface('app', '/o/acme/projects/p1'), { kind: 'allow' })
})

check('portal serves external-party pages, not the contractor company pages', () => {
  assert.deepEqual(m.routeForSurface('portal', '/o/acme/projects/p1/reviews'), { kind: 'allow' })
  assert.deepEqual(m.routeForSurface('portal', '/o/acme'), { kind: 'allow' })
  assert.deepEqual(m.routeForSurface('portal', '/accept-invite'), { kind: 'allow' })
  assert.deepEqual(m.routeForSurface('portal', '/o/acme/portfolio'), { kind: 'path', to: '/o/acme' })
  assert.deepEqual(m.routeForSurface('portal', '/o/acme/inventory'), { kind: 'path', to: '/o/acme' })
  assert.deepEqual(m.routeForSurface('portal', '/landing'), { kind: 'path', to: '/' })
})

check('public site keeps marketing pages and sends sign-in and the app to app.octapm.com', () => {
  assert.deepEqual(m.routeForSurface('public', '/'), { kind: 'path', to: '/landing' })
  assert.deepEqual(m.routeForSurface('public', '/landing'), { kind: 'allow' })
  assert.deepEqual(m.routeForSurface('public', '/privacy'), { kind: 'allow' })
  assert.deepEqual(m.routeForSurface('public', '/sign-in'), { kind: 'surface', surface: 'app', to: '/sign-in' })
  assert.deepEqual(m.routeForSurface('public', '/o/acme'), { kind: 'surface', surface: 'app', to: '/o/acme' })
  assert.deepEqual(m.routeForSurface('public', '/platform-admin'), { kind: 'surface', surface: 'admin', to: '/platform-admin' })
})

check('market host never serves this application', () => {
  assert.equal(m.routeForSurface('market', '/o/acme').kind, 'surface')
  assert.equal(m.routeForSurface('market', '/platform-admin').kind, 'surface')
})

check('combined mode changes nothing', () => {
  for (const path of ['/', '/platform-admin', '/o/acme/portfolio', '/landing']) {
    assert.deepEqual(m.routeForSurface('combined', path), { kind: 'allow' })
  }
})

check('cross-host links use the canonical host; same host stays relative', () => {
  onPage('https://app.octapm.com/o/acme')
  assert.equal(m.surfaceHref('admin', '/platform-admin', PROD), 'https://admin.octapm.com/platform-admin')
  assert.equal(m.surfaceHref('portal', '/accept-invite', PROD), 'https://portal.octapm.com/accept-invite')
  assert.equal(m.surfaceHref('app', '/o/acme', PROD), '/o/acme')
})

check('local previews link between *.localhost hosts on the same port', () => {
  onPage('http://admin.localhost:5300/platform-admin')
  assert.equal(m.surfaceHref('app', '/', NONE), 'http://localhost:5300/')
  assert.equal(m.surfaceHref('admin', '/platform-admin', NONE), '/platform-admin')
})

check('plain localhost links stay relative', () => {
  onPage('http://localhost:5300/')
  assert.equal(m.surfaceHref('admin', '/platform-admin', NONE), '/platform-admin')
  assert.equal(m.currentSurface(), 'combined')
})

check('return paths: only paths in this application (open-redirect protection)', () => {
  assert.equal(m.safeInternalPath('/o/acme/projects?x=1'), '/o/acme/projects?x=1')
  for (const bad of ['https://evil.example.com', '//evil.example.com', '/\\evil.example.com', 'javascript:alert(1)', 'evil', '', null, 42, '/a\nb']) {
    assert.equal(m.safeInternalPath(bad), null, String(bad))
  }
})

check('only the public site is indexed', () => {
  assert.equal(m.shouldIndex('public', '/landing'), true)
  assert.equal(m.shouldIndex('combined', '/landing'), true)
  for (const mode of ['app', 'portal', 'admin', 'market']) assert.equal(m.shouldIndex(mode, '/landing'), false)
  assert.equal(m.shouldIndex('combined', '/o/acme'), false)
})

console.log(`domains: ${passed} checks passed`)
