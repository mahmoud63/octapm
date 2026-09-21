#!/usr/bin/env node
/**
 * A release bundle must talk to the real API and nothing on a developer's desk.
 *
 * Vite bakes VITE_API_URL into the JavaScript at build time. A build made
 * without it calls same-origin /api/v1; a build made on a laptop picks up the
 * untracked frontend/.env and ships http://localhost:5000/api/v1 to every
 * browser. Neither fails the build, so this scan runs on the output:
 *
 *   node frontend/scripts/assert-release-bundle.mjs --dist frontend/dist \
 *     --expect-api https://api.octapm.com/api/v1
 *   node frontend/scripts/assert-release-bundle.mjs --self-test
 *
 * It fails when any .js, .mjs, .html, .css, .json or .webmanifest file under
 * the dist names a loopback, private or link-local origin with a port (or
 * with an /api path), or when the expected API URL appears nowhere. Portless
 * `http://localhost` strings inside third-party chunks are left alone: they are
 * library defaults and comments, never a server this app calls.
 *
 * --expect-api defaults to $VITE_API_URL, so a CI step can pass nothing and
 * check the value it built with. No dependencies.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.html', '.css', '.json', '.webmanifest'])

const LOCAL_HOST =
  String.raw`(?:localhost|[a-z0-9-]+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|\[::1?\])`
// A local host followed by a port, or by the API path: either is an address
// the app would actually call.
const LOCAL_ORIGIN = new RegExp(String.raw`(?:https?|wss?)://${LOCAL_HOST}(?::\d{1,5}|(?=/api\b))`, 'gi')

const listFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return listFiles(full)
    return SCANNED_EXTENSIONS.has(extname(entry.name).toLowerCase()) ? [full] : []
  })

/**
 * @returns {{ files: number, localOrigins: {file: string, match: string, context: string}[], expectedFound: boolean }}
 */
export const scanBundle = (distDir, expectedApi) => {
  const root = resolve(distDir)
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`${root} is not a directory; build the frontend first`)
  }
  const files = listFiles(root)
  const localOrigins = []
  let expectedFound = false
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    if (expectedApi && text.includes(expectedApi)) expectedFound = true
    for (const match of text.matchAll(LOCAL_ORIGIN)) {
      const start = Math.max(0, match.index - 40)
      localOrigins.push({
        file: relative(root, file),
        match: match[0],
        context: text.slice(start, match.index + match[0].length + 40).replace(/\s+/g, ' '),
      })
    }
  }
  return { files: files.length, localOrigins, expectedFound }
}

/** Every reason this bundle must not ship; empty when it may. */
export const releaseBundleProblems = (distDir, expectedApi) => {
  const problems = []
  const expected = String(expectedApi || '').trim()
  if (!expected) {
    problems.push('no expected API URL: pass --expect-api or set VITE_API_URL to the URL this build was made with')
  } else if (!/^https:\/\//.test(expected)) {
    problems.push(`the expected API URL ${expected} is not https`)
  }
  const scan = scanBundle(distDir, expected)
  if (scan.files === 0) problems.push(`no scannable files under ${resolve(distDir)}`)
  for (const hit of scan.localOrigins.slice(0, 20)) {
    problems.push(`${hit.file}: local origin ${hit.match} in "…${hit.context}…"`)
  }
  if (scan.localOrigins.length > 20) problems.push(`…and ${scan.localOrigins.length - 20} more local origins`)
  if (expected && !scan.expectedFound) {
    problems.push(`${expected} appears in no bundle file: this build was not made with VITE_API_URL=${expected}`)
  }
  return problems
}

const argValue = (args, name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const selfTest = () => {
  const dir = mkdtempSync(join(tmpdir(), 'octapm-bundle-'))
  const write = (name, text) => writeFileSync(join(dir, name), text)
  const expectFailure = (label, pattern) => {
    const problems = releaseBundleProblems(dir, 'https://api.octapm.com/api/v1')
    if (!problems.some((problem) => pattern.test(problem))) {
      throw new Error(`self-test: ${label} was not reported (${JSON.stringify(problems)})`)
    }
  }
  try {
    write('index.html', '<script src="/assets/index.js"></script>')
    write('index.js', 'const base="https://api.octapm.com/api/v1";const doc="see http://localhost for defaults";')
    let problems = releaseBundleProblems(dir, 'https://api.octapm.com/api/v1')
    if (problems.length) throw new Error(`self-test: a clean bundle was refused: ${problems.join('; ')}`)

    const leaks = [
      'http://localhost:5000/api/v1',
      'http://127.0.0.1:5000',
      'ws://localhost:5000',
      'http://192.168.1.20:5000',
      'http://10.0.2.2:5000',
      'http://172.20.0.3:5000',
      'http://[::1]:5000',
      'http://localhost/api/v1',
    ]
    for (const leak of leaks) {
      write('client.js', `const api="${leak}";`)
      expectFailure(leak, /local origin/)
    }
    write('client.js', 'const ok=1;')

    write('index.js', 'const base="/api/v1";')
    expectFailure('a build without VITE_API_URL', /appears in no bundle file/)

    problems = releaseBundleProblems(dir, '')
    if (!problems.some((problem) => /no expected API URL/.test(problem))) {
      throw new Error('self-test: a missing --expect-api was not reported')
    }
    console.log('Release bundle self-test passed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const main = () => {
  const args = process.argv.slice(2)
  if (args.includes('--self-test')) {
    selfTest()
    return
  }
  const here = dirname(fileURLToPath(import.meta.url))
  const dist = argValue(args, '--dist') ?? join(here, '..', 'dist')
  const expectedApi = argValue(args, '--expect-api') ?? process.env.VITE_API_URL
  const problems = releaseBundleProblems(dist, expectedApi)
  if (problems.length) {
    console.error(`Release bundle check failed for ${resolve(dist)}:\n- ${problems.join('\n- ')}`)
    process.exitCode = 1
    return
  }
  console.log(`Release bundle check passed: ${resolve(dist)} calls ${expectedApi} and names no local origin`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
