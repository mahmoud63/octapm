import { createFileRoute, redirect } from '@tanstack/react-router'
import axios from 'axios'
import { getMyProfile } from '@/services/auth/api'
import { useAuthStore } from '@/stores/auth-store'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

/**
 * Only a 401 means "not signed in".
 *
 * This guard used to treat any failure of /auth/me as proof the session was
 * gone: it cleared the store and redirected to the marketing page. So a rate
 * limit, a 500, or a dropped connection during the session check logged the
 * user out and threw away whatever they were part-way through entering. The
 * request layer already refreshes an expired access token, so a non-401 here is
 * a fault to ride out, not a verdict on the session.
 */
const isUnauthenticated = (error: unknown): boolean => {
  if (axios.isAxiosError(error)) {
    // No response at all means the network failed, which proves nothing.
    return error.response?.status === 401
  }
  return false
}

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const { auth } = useAuthStore.getState()

    if (auth.user) return

    try {
      auth.setUser(await getMyProfile())
      return
    } catch (error) {
      if (isUnauthenticated(error)) {
        auth.reset()
        throw redirect({ to: '/landing' })
      }

      // One retry, because the common case is a transient blip.
      try {
        auth.setUser(await getMyProfile())
        return
      } catch (retryError) {
        if (isUnauthenticated(retryError)) {
          auth.reset()
          throw redirect({ to: '/landing' })
        }
        // Still failing, but not with a 401: keep the session and let the page
        // load. Individual screens surface their own load errors, which is far
        // better than silently signing someone out.
      }
    }
  },
  component: AuthenticatedLayout,
})
