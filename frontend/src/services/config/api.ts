import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

/**
 * What the server tells anyone, signed in or not. Today that is only whether
 * self-service registration is open: in production it is closed unless the
 * operator opens it, and organisations join by invitation instead.
 */
export interface PublicConfig {
  registration: 'open' | 'closed'
}

const unwrap = <T>(response: { data: { data: T } }): T => response.data.data

export const getPublicConfig = () =>
  apiClient.get('/config/public').then(unwrap<PublicConfig>)

export const publicConfigQueryKey = ['public-config'] as const

export type RegistrationState = 'open' | 'closed' | 'loading'

/**
 * Whether to offer self-service sign-up. The server stays the authority —
 * POST /auth/register refuses on its own when closed — so if the answer cannot
 * be fetched the screens fall back to offering it, exactly as they did before
 * the switch existed. Cached for the session: it changes only on a redeploy.
 */
export function useRegistrationState(): RegistrationState {
  const query = useQuery({
    queryKey: publicConfigQueryKey,
    queryFn: getPublicConfig,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
  if (query.isPending) return 'loading'
  return query.data?.registration === 'closed' ? 'closed' : 'open'
}

/** True unless the server has said registration is closed. */
export function useRegistrationOpen(): boolean {
  return useRegistrationState() !== 'closed'
}
