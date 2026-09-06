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
}

export interface MfaChallenge {
  mfaRequired: true
  mfaToken: string
  methods: Array<'totp' | 'backup_code'>
}

export type LoginResult = AuthSession | MfaChallenge

export const isMfaChallenge = (result: LoginResult): result is MfaChallenge =>
  (result as MfaChallenge).mfaRequired === true

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
