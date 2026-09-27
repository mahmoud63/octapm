import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-SEC-AUTH-040 — single sign-on and two-factor wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const backend = (rel) => readFileSync(path.join(root, '..', 'backend', rel), 'utf8')

const api = read('src/services/auth/api.ts')
const types = read('src/services/auth/types.ts')
const signIn = read('src/features/auth/sign-in/components/user-auth-form.tsx')
const ssoComplete = read('src/features/auth/sso-complete/index.tsx')
const ssoRoute = read('src/routes/(auth)/sso.complete.tsx')
const securityForm = read('src/features/settings/security/security-form.tsx')
const settingsNav = read('src/features/settings/index.tsx')
const companySecurity = read('src/features/company/security.tsx')
const companyNav = read('src/features/company/index.tsx')
const companyHooks = read('src/features/company/hooks/use-security.ts')
const authRoutes = backend('src/routes/auth.js')
const authSecurity = backend('src/routes/auth-security.js')
const companySecurityRoutes = backend('src/routes/company-security.js')
const app = backend('src/app.js')
const authService = backend('src/services/auth.service.js')
const mfaService = backend('src/services/mfa.service.js')
const ssoService = backend('src/services/sso.service.js')
const totp = backend('src/utils/totp.js')
const schema = backend('prisma/schema.prisma')

for (const name of ['verifyMfa', 'getMfaStatus', 'startMfaSetup', 'enableMfa', 'disableMfa', 'regenerateMfaBackupCodes', 'ssoLookup', 'ssoStart', 'ssoComplete']) {
  assert.match(api, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(types, /export type LoginResult = AuthSession \| MfaChallenge/, 'login result union')
assert.match(types, /export const isMfaChallenge/, 'challenge guard')

assert.match(signIn, /data-testid='uat-sign-in-mfa'/, 'MFA step on the sign-in form')
assert.match(signIn, /data-testid='uat-sign-in-mfa-submit'/, 'verify button')
assert.match(signIn, /Use a backup code/, 'backup code path')
assert.match(signIn, /data-testid='uat-sign-in-sso'/, 'SSO button for matched domains')
assert.match(signIn, /data-testid='uat-sign-in-sso-generic'/, 'generic SSO entry')
assert.match(signIn, /window\.location\.assign\(authorizationUrl\)/, 'browser goes to the identity provider')
assert.match(signIn, /ssoError/, 'provider errors surfaced')
assert.match(signIn, /SSO_REQUIRED/, 'SSO-only domains switch the form')
assert.match(ssoComplete, /export function SsoComplete/, 'completion page')
assert.match(ssoComplete, /ssoComplete\(ticket\)/, 'ticket exchanged for the session')
assert.match(ssoRoute, /createFileRoute\('\/\(auth\)\/sso\/complete'\)/, 'public completion route')

assert.match(securityForm, /export function SecurityForm/, 'settings security form')
assert.match(securityForm, /data-testid='uat-mfa-setup'/, 'set up')
assert.match(securityForm, /data-testid='uat-mfa-enable'/, 'turn on')
assert.match(securityForm, /data-testid='uat-mfa-backup-codes'/, 'backup codes shown once')
assert.match(securityForm, /data-testid='uat-mfa-regenerate'/, 'regenerate')
assert.match(securityForm, /data-testid='uat-mfa-disable-confirm'/, 'turn off with password and code')
assert.match(securityForm, /dangerouslySetInnerHTML=\{\{ __html: setup\.qrSvg \}\}/, 'QR from our server')
assert.match(settingsNav, /href: '\/settings\/security'/, 'settings nav')

assert.match(companySecurity, /export function CompanySecurity/, 'company security page')
assert.match(companySecurity, /data-testid='uat-sso-issuer'/, 'issuer field')
assert.match(companySecurity, /data-testid='uat-sso-test'/, 'test connection')
assert.match(companySecurity, /data-testid='uat-mfa-required'/, 'MFA policy')
assert.match(companySecurity, /data-testid='uat-mfa-reset'/, 'reset a user')
assert.match(companyNav, /href: '\/company\/security'/, 'company nav')
for (const name of ['useCompanySecurity', 'useUpdateSso', 'useTestSso', 'useResetUserMfa']) assert.match(companyHooks, new RegExp(`export const ${name}\\b`), `${name} exported`)

// ENT-2 widened the same early return: an identity with no single workspace to
// enter gets no session either (chooseWorkspace / needsWorkspace).
assert.match(
  authRoutes,
  /if \(result\.mfaRequired(?: \|\| result\.\w+)*\) \{?\s*return sendSuccess\(res, result\)/,
  'no session before the second factor',
)
assert.match(authRoutes, /require\("\.\/auth-security"\)\.register\(router/, 'security routes on the auth router')
assert.match(authSecurity, /"\/sso\/callback"/, 'callback route')
assert.match(authSecurity, /"\/mfa\/verify"/, 'verify route')
assert.match(companySecurityRoutes, /router\.use\(requireCompanyAdmin\)/, 'company security is admin only')
assert.match(app, /require\("\.\/routes\/company-security"\)/, 'company security mounted')
assert.match(authService, /SSO_REQUIRED/, 'SSO-only policy enforced at password login')
assert.match(authService, /mfaRequired: true,/, 'MFA challenge returned instead of a session')
assert.match(mfaService, /createCipheriv\("aes-256-gcm"/, 'secrets encrypted at rest')
assert.match(mfaService, /hashCode\(value\)/, 'backup codes hashed')
assert.match(ssoService, /code_challenge_method", "S256"/, 'PKCE')
assert.match(ssoService, /jwks_uri/, 'ID tokens verified against JWKS')
assert.match(ssoService, /claims\.nonce !== nonce/, 'nonce checked')
assert.match(ssoService, /ssoTicket\.create/, 'one-time ticket instead of tokens in the URL')
assert.match(totp, /RFC 6238/, 'dependency-free TOTP')
assert.match(schema, /^model SsoTicket \{/m, 'SsoTicket model')
assert.match(schema, /mfaSecretEnc\s+String\?/, 'MFA fields on User')
assert.match(schema, /ssoClientSecretEnc String\?/, 'SSO fields on Organisation')

console.log('auth-security-ui: ok')
