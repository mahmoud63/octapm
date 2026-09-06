# Single sign-on and two-factor authentication (OCTA-SEC-AUTH-040)

Two independent protections on the sign-in:

- **Single sign-on** — one OpenID Connect provider per organisation
  (Microsoft Entra ID, Okta, Google Workspace, Auth0, Keycloak…): discovery,
  authorization code + PKCE (S256), signed state and nonce, ID token
  verified against the provider's JWKS, email-domain routing, optional
  auto-provisioning with a default role, and an "SSO only" policy per
  domain. Tokens never travel in a URL — the callback hands the browser a
  one-time ticket that the app exchanges for the normal session.
- **Two-factor** — TOTP with any authenticator app (RFC 6238, SHA-1, 6
  digits, 30 s, ±1 step), ten single-use backup codes, a five-minute
  challenge token between password and code, an organisation-wide
  requirement, and an admin reset. Secrets are encrypted at rest
  (AES-256-GCM, key from `MFA_SECRET_KEY`, else `INTEGRATION_SECRET_KEY`,
  else `JWT_SECRET`); backup codes are stored as SHA-256 hashes.

## Where

- **Sign in**: typing an email that belongs to an SSO organisation shows
  *Continue with <organisation> SSO* (the password field disappears when
  SSO is mandatory for that domain); *Sign in with company SSO* asks for the
  email otherwise. After a password, accounts with a second factor get the
  code step (authenticator code or *Use a backup code*; *Start again*).
  Provider failures come back as `?ssoError=…` and are explained.
- `/sso/complete?ticket=…` — completes an SSO sign-in.
- **Settings › Security** (every user): status, *Set up* → QR code (SVG
  from our server) + manual key → *Turn on* with a code → backup codes shown
  once (copy); *New backup codes* (needs a current code); *Turn off…*
  (password + code; refused when the organisation requires it).
- **Company › Security** (company admins): SSO form (enabled, issuer,
  client id, client secret — stored encrypted, shown as "set", email domains,
  default role, create accounts on first sign-in, SSO only), the redirect URI
  to register with the provider, *Test connection* (reads the discovery
  document), *Required for everyone* MFA policy, and the people table
  (2FA on/off, SSO linked, last sign-in, *Reset 2FA*).

## Rules

- Password login: `SSO_REQUIRED` (403) for users of SSO-only domains who
  are not company admins; `mfaRequired: true` + `mfaToken` instead of a
  session when the account has a second factor; `user.mfaEnrollmentRequired`
  when the organisation requires MFA and the user has none.
- `POST /auth/mfa/verify` accepts a TOTP (±1 step) or an unused backup
  code; failures count towards the login lockout and are audited
  (`mfa.failed`); success audits `mfa.verified`.
- Enabling needs a live code against the pending secret; disabling needs
  the password and a code, and is refused for non-admins when the
  organisation requires MFA (`MFA_REQUIRED_BY_ORG`).
- SSO settings: enabling needs issuer + client id + secret
  (`SSO_INCOMPLETE`); SSO-only needs at least one domain
  (`SSO_DOMAINS_REQUIRED`); the issuer must be https. Discovery documents are
  cached 10 minutes.
- Callback: state (10 min, signed) → token exchange with the PKCE verifier
  → ID token signature (RS/PS/ES), issuer, audience, expiry and nonce →
  email (`email` / `preferred_username` / `upn`, `email_verified !== false`)
  → user by `ssoSubject` or email in the organisation; unknown users are
  provisioned when allowed (and the domain is listed), else
  `SSO_USER_NOT_FOUND`; an email known to another organisation is refused.
  Tickets live two minutes and work once. Audit: `sso.user_provisioned`,
  `sso.login`, `sso.login_failed`, `sso.settings_updated`.
- SSO sign-ins skip the app's second factor (the identity provider enforces
  its own).

## API

Tag "Auth": `POST /auth/mfa/verify`, `GET /auth/mfa`, `POST /auth/mfa/setup`,
`POST /auth/mfa/enable`, `POST /auth/mfa/disable`,
`POST /auth/mfa/backup-codes`, `GET /auth/sso/lookup?email`,
`POST /auth/sso/start`, `GET /auth/sso/callback` (302), `POST /auth/sso/complete`.
Tag "Company Workspace" (company admin): `GET /company/security`,
`PUT /company/security/sso`, `POST /company/security/sso/test`,
`POST /company/security/users/{userId}/mfa/reset`.

## Test

```bash
cd backend && npx jest src/utils/__tests__/totp.test.js src/services/__tests__/mfa.service.test.js src/services/__tests__/sso.service.test.js
cd frontend && node scripts/auth-security-ui.test.mjs
```

Manual (MFA): Settings › Security → Set up → scan with an authenticator →
Turn on → save the backup codes → sign out → sign in → code step → in.
Manual (SSO): register the redirect URI in the provider → Company ›
Security → issuer / client id / secret / domains → Test connection → enable
→ sign out → type a domain email → *Continue with SSO* → provider → back in
OctaPM signed in; the user row shows *linked*.

## Configuration

`WEB_APP_URL` (completion and error redirects), `API_BASE_URL` or
`SSO_REDIRECT_URI` (callback registered with the provider),
`MFA_SECRET_KEY` (secret encryption; falls back to `INTEGRATION_SECRET_KEY`
then `JWT_SECRET`), `MFA_ISSUER` (name shown in authenticator apps, default
"OctaPM"), `JWT_SECRET` (challenge and state tokens).
