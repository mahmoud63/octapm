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
  RegisterPayload,
  RegisterResponse,
  ResetPasswordPayload,
  ResetPasswordResponse,
} from '@/services/auth/types'

const unwrapData = <T>(response: { data: ApiSuccess<T> }): T => {
  return response.data.data
}

export const login = async (payload: LoginPayload): Promise<AuthSession> => {
  const response = await apiClient.post<ApiSuccess<AuthSession>>(
    '/auth/login',
    payload
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
