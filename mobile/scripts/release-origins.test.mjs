/**
 * The release-origin guard, through Expo's real config loader.
 *
 * Each case runs `expo config` as a child process with exactly the variables
 * an EAS build of that profile would have, so what is tested is the path a
 * build takes: app.config.js → assertReleaseOrigins. The address table at the
 * end checks the rule itself without paying for a process per address.
 *
 *   npm run test:release-config
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXPO_CLI = require.resolve('expo/bin/cli', { paths: [MOBILE_ROOT] })
const { collectReleaseOriginProblems } = require('./release-origins.cjs')
const easProfiles = JSON.parse(readFileSync(path.join(MOBILE_ROOT, 'eas.json'), 'utf8')).build

/** This process's environment without anything that decides a build's origins. */
const baseEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('EXPO_PUBLIC_') && !key.startsWith('EAS_BUILD')),
  )

const expoConfig = (env) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [EXPO_CLI, 'config', '--json', '--type', 'public'], {
      cwd: MOBILE_ROOT,
      env: { ...baseEnv(), ...env },
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('exit', (code) => resolve({ code, stdout, stderr }))
  })

describe('expo config with the release guard', { concurrency: 4 }, () => {
  test('development: no variables at all still loads app.json unchanged', async () => {
    const { code, stdout, stderr } = await expoConfig({})
    assert.equal(code, 0, stderr)
    const config = JSON.parse(stdout)
    const appJson = JSON.parse(readFileSync(path.join(MOBILE_ROOT, 'app.json'), 'utf8')).expo
    assert.equal(config.slug, appJson.slug)
    assert.deepEqual(config.ios.infoPlist, appJson.ios.infoPlist)
    assert.deepEqual(config.extra.eas, appJson.extra.eas)
  })

  test('the EAS development profile builds with nothing else set', async () => {
    const { code, stderr } = await expoConfig({ EAS_BUILD_PROFILE: 'development', ...easProfiles.development.env })
    assert.equal(code, 0, stderr)
  })

  test('production without an API origin is refused', async () => {
    const { code, stderr } = await expoConfig({ EXPO_PUBLIC_ENV: 'production' })
    assert.notEqual(code, 0)
    assert.match(stderr, /EXPO_PUBLIC_API_ORIGIN is not set/)
  })

  test('production pointed at the localhost fallback is refused', async () => {
    const { code, stderr } = await expoConfig({
      EXPO_PUBLIC_ENV: 'production',
      EXPO_PUBLIC_API_ORIGIN: 'http://localhost:5000',
      EXPO_PUBLIC_WEB_ORIGIN: 'https://app.octapm.com',
    })
    assert.notEqual(code, 0)
    assert.match(stderr, /EXPO_PUBLIC_API_ORIGIN="http:\/\/localhost:5000" must use https/)
  })

  test('plain http to a public host is refused', async () => {
    const { code, stderr } = await expoConfig({
      EXPO_PUBLIC_ENV: 'production',
      EXPO_PUBLIC_API_ORIGIN: 'http://api.octapm.com',
      EXPO_PUBLIC_WEB_ORIGIN: 'https://app.octapm.com',
    })
    assert.notEqual(code, 0)
    assert.match(stderr, /must use https/)
  })

  test('an EAS preview build with no EXPO_PUBLIC_ENV is still a release', async () => {
    const { code, stderr } = await expoConfig({ EAS_BUILD_PROFILE: 'preview' })
    assert.notEqual(code, 0)
    assert.match(stderr, /EAS build profile "preview"/)
  })

  for (const [profile, settings] of Object.entries(easProfiles)) {
    if (profile === 'development') continue
    test(`the eas.json "${profile}" profile passes as written`, async () => {
      const { code, stdout, stderr } = await expoConfig({ EAS_BUILD_PROFILE: profile, ...settings.env })
      assert.equal(code, 0, stderr)
      assert.equal(JSON.parse(stdout).slug, 'octapm')
    })
  }
})

describe('eas.json profiles', () => {
  test('every profile other than development is https on a public host', () => {
    for (const [profile, settings] of Object.entries(easProfiles)) {
      if (profile === 'development') continue
      assert.deepEqual(collectReleaseOriginProblems({ EAS_BUILD_PROFILE: profile, ...settings.env }), [], profile)
      assert.match(settings.env.EXPO_PUBLIC_API_ORIGIN, /^https:\/\//)
    }
  })

  test('nothing is set up to submit to a store', () => {
    const eas = JSON.parse(readFileSync(path.join(MOBILE_ROOT, 'eas.json'), 'utf8'))
    assert.equal(eas.submit, undefined)
  })
})

describe('which origins a release may carry', () => {
  const release = (api) => ({
    EXPO_PUBLIC_ENV: 'staging',
    EXPO_PUBLIC_API_ORIGIN: api,
    EXPO_PUBLIC_WEB_ORIGIN: 'https://app.staging.octapm.com',
  })
  const refused = [
    'https://localhost:5000',
    'https://dev.localhost',
    'https://127.0.0.1:5000',
    'https://10.0.2.2:5000',
    'https://172.20.1.5',
    'https://192.168.1.20:5000',
    'https://169.254.169.254',
    'https://100.64.0.1',
    'https://0.0.0.0',
    'https://[::1]:5000',
    'https://[fd12:3456::1]',
    'https://[fe80::1]',
    'https://devbox',
    'https://octapm.local',
    'https://api.octapm.com/api/v1',
    'https://api.octapm.com?x=1',
    'https://user:pw@api.octapm.com',
    'ftp://api.octapm.com',
    'not a url',
  ]
  for (const api of refused) {
    test(`refuses ${api}`, () => {
      assert.equal(collectReleaseOriginProblems(release(api)).length, 1)
    })
  }

  const allowed = ['https://api.octapm.com', 'https://api.staging.octapm.com/', 'https://172.32.0.1', 'https://8.8.8.8']
  for (const api of allowed) {
    test(`allows ${api}`, () => {
      assert.deepEqual(collectReleaseOriginProblems(release(api)), [])
    })
  }

  test('a misspelt environment name is refused rather than treated as development', () => {
    assert.match(collectReleaseOriginProblems({ EXPO_PUBLIC_ENV: 'prod' })[0], /must be one of/)
  })

  test('local and development need nothing', () => {
    assert.deepEqual(collectReleaseOriginProblems({}), [])
    assert.deepEqual(collectReleaseOriginProblems({ EXPO_PUBLIC_ENV: 'local' }), [])
    assert.deepEqual(collectReleaseOriginProblems({ EXPO_PUBLIC_ENV: 'development' }), [])
  })
})
