/**
 * One workspace the identity belongs to (membership doc §3, §6). `slug` is
 * the URL handle under `/o/`; an organisation that has none yet is addressed
 * by its id instead (`workspaceSegment`).
 */
export interface WorkspaceMembership {
  orgId: string
  membershipId: string | null
  slug: string | null
  name: string | null
  kind: 'personal' | 'company'
  role: string
  isAdmin: boolean
  isOwner: boolean
  status: 'invited' | 'active' | 'suspended'
}

/** The workspace the session's token is bound to (workspace switching doc §1). */
export interface ActiveWorkspace extends WorkspaceMembership {
  /** What goes after `/o/` in every URL of this workspace. */
  segment: string
}

export interface AuthUser {
  id: string
  orgId: string
  name: string
  email: string
  phone?: string | null
  role: string
  /** Org-wide project visibility plus user and permission-template administration. */
  isCompanyAdmin?: boolean
  status: string
  lastLogin?: string | null
  /** Two-factor authentication is enrolled (OCTA-SEC-AUTH-040). */
  mfaEnabled?: boolean
  /** Signed in through single sign-on at least once. */
  ssoLinked?: boolean
  /** The organisation requires a second factor and this user has none yet. */
  mfaEnrollmentRequired?: boolean
  createdAt?: string
  updatedAt?: string
  /** Every workspace the identity belongs to — only on `GET /auth/me`. */
  memberships?: WorkspaceMembership[]
  /** The workspace this token is bound to — only on `GET /auth/me`; null for an identity token. */
  active?: { orgId: string; membershipId: string | null } | null
}

export interface MfaChallenge {
  mfaRequired: true
  mfaToken: string
  methods: Array<'totp' | 'backup_code'>
}

/**
 * A sign-in that proved the identity but could not pick a workspace for it
 * (membership doc §6): several to choose from, or none it can enter. The
 * identity token opens exactly `POST /auth/workspaces/:orgId/session`,
 * `GET /auth/me` and `GET /auth/workspaces/resolve`.
 */
export interface WorkspaceChoice {
  chooseWorkspace?: true
  needsWorkspace?: true
  identityToken: string
  memberships: WorkspaceMembership[]
}

export type LoginResult = AuthSession | MfaChallenge | WorkspaceChoice

export const isMfaChallenge = (result: LoginResult): result is MfaChallenge =>
  (result as MfaChallenge).mfaRequired === true

export const isWorkspaceChoice = (
  result: LoginResult
): result is WorkspaceChoice =>
  typeof (result as WorkspaceChoice).identityToken === 'string' &&
  Array.isArray((result as WorkspaceChoice).memberships)

/** `GET /auth/workspaces/resolve?projectId=`: which workspace a legacy link belongs to. */
export interface WorkspaceResolution {
  project: { id: string; name: string }
  workspace: WorkspaceMembership & { segment: string }
  /** Whether that workspace is the one the token is bound to; null for an identity token. */
  active: boolean | null
}

export interface MfaVerifyPayload {
  mfaToken: string
  code: string
}

export interface MfaStatus {
  enabled: boolean
  enrolledAt: string | null
  backupCodesRemaining: number
  pending: boolean
  required: boolean
  enrollmentRequired: boolean
  ssoLinked: boolean
}

export interface MfaSetup {
  secret: string
  otpauthUrl: string
  qrSvg: string
  issuer: string
  account: string
}

export interface SsoLookup {
  sso: boolean
  required: boolean
  orgName: string | null
}

export interface AuthTokens {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
}

export interface AuthSession {
  user: AuthUser
  tokens: AuthTokens
  /** The workspace the new session is bound to — on a workspace session issue. */
  workspace?: WorkspaceMembership
  /** Every workspace the identity belongs to — on a workspace session issue. */
  memberships?: WorkspaceMembership[]
}

export interface RegisterPayload {
  orgName?: string
  name: string
  email: string
  password: string
  phone?: string
}

export interface RegisterResponse extends AuthSession {
  organisation: {
    id: string
    name: string
    plan: string
    status: string
  }
}

export interface LoginPayload {
  email: string
  password: string
}

export interface ForgotPasswordPayload {
  email: string
}

export interface ForgotPasswordResponse {
  sent: boolean
}

export interface ResetPasswordPayload {
  token: string
  password: string
}

export interface ResetPasswordResponse {
  reset: boolean
}

export interface InvitationPreview {
  email: string
  role: string
  org: {
    id: string
    name: string
  }
  project: {
    id: string
    name: string
  } | null
  company?: {
    id: string
    name: string
  } | null
  projectParty?: {
    id: string
    role: string
    company: {
      id: string
      name: string
    }
  } | null
  expiresAt: string
  existingUser: boolean
  requiresPassword: boolean
}

export interface AcceptInvitationPayload {
  token: string
  name: string
  password?: string
  phone?: string
}

export interface ApiSuccess<T> {
  success: true
  data: T
}

export interface ApiErrorEnvelope {
  success: false
  error: {
    code: string
    message: string
    details?: unknown
  }
}
