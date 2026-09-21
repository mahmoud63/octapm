import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Where a deployment has self-service registration closed (production, unless
// PUBLIC_REGISTRATION=true), the web app must not offer a sign-up it would
// then refuse: /sign-up explains that organisations join by invitation, and
// no call to action leads there. The server is the authority, so a failed
// fetch of the switch falls back to offering sign-up, as before it existed.

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const configApi = read('src/services/config/api.ts')
const signUp = read('src/features/auth/sign-up/index.tsx')
const signIn = read('src/features/auth/sign-in/index.tsx')
const forgot = read('src/features/auth/forgot-password/index.tsx')
const landing = read('src/features/landing/index.tsx')

assert.ok(
  configApi.includes("'/config/public'") &&
    /registration === 'closed' \? 'closed' : 'open'/.test(configApi),
  'the switch is read from GET /config/public, and anything but an explicit "closed" counts as open'
)

assert.ok(
  /if \(registration === 'closed'\) \{\s*return <InvitationOnly \/>/.test(signUp) &&
    signUp.includes("data-testid='sign-up-invitation-only'") &&
    /registration === 'open' \? <SignUpForm \/> : null/.test(signUp),
  'sign-up shows the invitation notice when closed, and the form only once the server has said open'
)
assert.ok(
  !/function InvitationOnly[\s\S]*<SignUpForm/.test(signUp),
  'the invitation notice carries no sign-up form'
)

// Every link to /sign-up must sit behind the switch: inside a
// `registrationOpen ? … ` or `registrationOpen && …` that opens at most four
// lines above it.
const unguardedSignUpLinks = (source) => {
  const lines = source.split(/\r?\n/)
  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.includes("'/sign-up'"))
    .filter(({ index }) => {
      const context = lines.slice(Math.max(0, index - 4), index + 1).join('\n')
      return !/registrationOpen\s*(\?|&&)/.test(context)
    })
    .map(({ line, index }) => `${index + 1}: ${line.trim()}`)
}

for (const [name, source] of [
  ['sign-in', signIn],
  ['forgot-password', forgot],
  ['landing', landing],
]) {
  assert.deepEqual(
    unguardedSignUpLinks(source),
    [],
    `${name} links to /sign-up without checking whether registration is open`
  )
  assert.ok(
    /useRegistrationOpen\(\)/.test(source),
    `${name} reads the registration switch`
  )
}

assert.ok(
  signIn.includes('Ask your company administrator for an invitation') &&
    forgot.includes('Ask your company administrator for an invitation'),
  'sign-in and forgot-password say how to join when sign-up is closed'
)

console.log('Registration gate UI assertions passed')
