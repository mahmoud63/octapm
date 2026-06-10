import { apiClient } from '@/services/api/client'
import type {
  ApiSuccess,
  AuthSession,
  AuthUser,
  LoginPayload,
  RegisterPayload,
  RegisterResponse,
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
  const response = await apiClient.post<ApiSuccess<AuthSession>>(
    '/auth/refresh'
  )
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
