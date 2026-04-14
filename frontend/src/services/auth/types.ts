export interface AuthUser {
  id: string
  orgId: string
  name: string
  email: string
  phone?: string | null
  role: string
  status: string
  lastLogin?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  tokenType: 'Bearer'
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

export interface RefreshPayload {
  refreshToken: string
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
