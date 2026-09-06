import { apiClient } from '@/services/api/client'
import type {
  ApiSuccess,
  AcceptInvitationPayload,
  AuthSession,
  AuthUser,
  ForgotPasswordPayload,
  ForgotPasswordResponse,
  InvitationPreview,
  LoginPayload,
  LoginResult,
  MfaSetup,
  MfaStatus,
  MfaVerifyPayload,
  RegisterPayload,
  RegisterResponse,
  ResetPasswordPayload,
  ResetPasswordResponse,
  SsoLookup,
} from '@/services/auth/types'

const unwrapData = <T>(response: { data: ApiSuccess<T> }): T => {
  return response.data.data
}

/** Password login: a session, or an MFA challenge when the account has a second factor. */
export const login = async (payload: LoginPayload): Promise<LoginResult> => {
  const response = await apiClient.post<ApiSuccess<LoginResult>>(
    '/auth/login',
    payload
  )
  return unwrapData(response)
}

export const verifyMfa = async (
  payload: MfaVerifyPayload
): Promise<AuthSession> => {
  const response = await apiClient.post<ApiSuccess<AuthSession>>(
    '/auth/mfa/verify',
    payload
  )
  return unwrapData(response)
}

export const getMfaStatus = async (): Promise<MfaStatus> => {
  const response = await apiClient.get<ApiSuccess<MfaStatus>>('/auth/mfa')
  return unwrapData(response)
}

export const startMfaSetup = async (): Promise<MfaSetup> => {
  const response = await apiClient.post<ApiSuccess<MfaSetup>>('/auth/mfa/setup')
  return unwrapData(response)
}

export const enableMfa = async (
  code: string
): Promise<{ enabled: boolean; backupCodes: string[] }> => {
  const response = await apiClient.post<
    ApiSuccess<{ enabled: boolean; backupCodes: string[] }>
  >('/auth/mfa/enable', { code })
  return unwrapData(response)
}

export const disableMfa = async (payload: {
  password: string
  code: string
}): Promise<{ enabled: boolean }> => {
  const response = await apiClient.post<ApiSuccess<{ enabled: boolean }>>(
    '/auth/mfa/disable',
    payload
  )
  return unwrapData(response)
}

export const regenerateMfaBackupCodes = async (
  code: string
): Promise<{ backupCodes: string[] }> => {
  const response = await apiClient.post<ApiSuccess<{ backupCodes: string[] }>>(
    '/auth/mfa/backup-codes',
    { code }
  )
  return unwrapData(response)
}

export const ssoLookup = async (email: string): Promise<SsoLookup> => {
  const response = await apiClient.get<ApiSuccess<SsoLookup>>(
    '/auth/sso/lookup',
    { params: { email } }
  )
  return unwrapData(response)
}

export const ssoStart = async (payload: {
  email?: string | null
  redirectTo?: string | null
}): Promise<{ authorizationUrl: string; orgName: string }> => {
  const response = await apiClient.post<
    ApiSuccess<{ authorizationUrl: string; orgName: string }>
  >('/auth/sso/start', payload)
  return unwrapData(response)
}

export const ssoComplete = async (ticket: string): Promise<AuthSession> => {
  const response = await apiClient.post<ApiSuccess<AuthSession>>(
    '/auth/sso/complete',
    { ticket }
  )
  return unwrapData(response)
}

export const register = async (
  payload: RegisterPayload
): Promise<RegisterResponse> => {
  const response = await apiClient.post<ApiSuccess<RegisterResponse>>(
    '/auth/register',
    payload
  )
  return unwrapData(response)
}

export const refreshSession = async (): Promise<AuthSession> => {
  const response =
    await apiClient.post<ApiSuccess<AuthSession>>('/auth/refresh')
  return unwrapData(response)
}

export const logout = async (): Promise<{ revoked: boolean }> => {
  const response =
    await apiClient.post<ApiSuccess<{ revoked: boolean }>>('/auth/logout')
  return unwrapData(response)
}

export const getMyProfile = async (): Promise<AuthUser> => {
  const response = await apiClient.get<ApiSuccess<AuthUser>>('/auth/me')
  return unwrapData(response)
}

export const requestPasswordReset = async (
  payload: ForgotPasswordPayload
): Promise<ForgotPasswordResponse> => {
  const response = await apiClient.post<ApiSuccess<ForgotPasswordResponse>>(
    '/auth/forgot-password',
    payload
  )
  return unwrapData(response)
}

export const resetPassword = async (
  payload: ResetPasswordPayload
): Promise<ResetPasswordResponse> => {
  const response = await apiClient.post<ApiSuccess<ResetPasswordResponse>>(
    '/auth/reset-password',
    payload
  )
  return unwrapData(response)
}

export const getInvitationPreview = async (
  token: string
): Promise<InvitationPreview> => {
  const response = await apiClient.get<ApiSuccess<InvitationPreview>>(
    `/auth/invitations/${encodeURIComponent(token)}`
  )
  return unwrapData(response)
}

export const acceptInvitation = async (
  payload: AcceptInvitationPayload
): Promise<AuthSession> => {
  const response = await apiClient.post<ApiSuccess<AuthSession>>(
    '/auth/invitations/accept',
    payload
  )
  return unwrapData(response)
}
