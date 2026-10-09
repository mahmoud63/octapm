import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/** Company › Security (OCTA-SEC-AUTH-040): SSO settings, MFA policy and users' factor status. */

export interface SsoSettings {
  enabled: boolean
  provider: 'oidc'
  issuer: string | null
  clientId: string | null
  clientSecretSet: boolean
  domains: string[]
  /** Retired (D-ID-1): always false — single sign-on never creates accounts. */
  autoProvision: false
  /** Served for older clients; nothing uses it since provisioning was retired. */
  defaultRole: string
  required: boolean
  mfaRequired: boolean
  redirectUri: string
  updatedAt: string | null
}

export interface SecurityUser {
  id: string
  name: string
  email: string
  role: string
  status: string
  isCompanyAdmin: boolean
  mfaEnabled: boolean
  mfaEnrolledAt: string | null
  ssoLinked: boolean
  ssoLinkedAt: string | null
  lastLogin: string | null
}

export interface CompanySecurity {
  sso: SsoSettings
  mfaRequired: boolean
  users: SecurityUser[]
  summary: { users: number; mfaEnabled: number; ssoLinked: number }
}

export interface SsoSettingsPayload {
  enabled?: boolean
  issuer?: string | null
  clientId?: string | null
  clientSecret?: string | null
  domains?: string[]
  // No autoProvision: the server refuses `true` (SSO_AUTO_PROVISION_RETIRED).
  required?: boolean
  mfaRequired?: boolean
}

export interface SsoTestResult {
  ok: boolean
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  jwksUri: string
  scopes: string[]
  codeChallengeMethods: string[]
  redirectUri: string
}

const data = <T>(promise: Promise<{ data: { data: T } }>) =>
  promise.then((response) => response.data.data)
const KEY = ['company', 'security'] as const

export const useCompanySecurity = () =>
  useQuery<CompanySecurity>({
    queryKey: KEY,
    queryFn: () => data(apiClient.get('/company/security')),
  })

export const useUpdateSso = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SsoSettingsPayload) =>
      data<SsoSettings>(apiClient.put('/company/security/sso', payload)),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export const useTestSso = () =>
  useMutation({
    mutationFn: () =>
      data<SsoTestResult>(
        apiClient.post('/company/security/sso/test', {}, { timeout: 30_000 })
      ),
  })

export const useResetUserMfa = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      data<{ reset: boolean }>(
        apiClient.post(`/company/security/users/${userId}/mfa/reset`)
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
