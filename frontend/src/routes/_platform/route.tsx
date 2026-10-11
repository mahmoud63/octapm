import axios from 'axios'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getMyProfile, logout } from '@/services/auth/api'
import { platformAdminApi } from '@/services/platform-admin/api'
import { useAuthStore } from '@/stores/auth-store'
import { NotFoundError } from '@/features/errors/not-found-error'
import { PlatformConsoleLayout } from '@/features/platform-admin/components/console-layout'
import { PLATFORM_SESSION_KEY } from '@/features/platform-admin/lib/session'

const statusOf = (error: unknown) =>
  axios.isAxiosError(error) ? error.response?.status : undefined
const codeOf = (error: unknown) =>
  axios.isAxiosError(error)
    ? (error.response?.data as { error?: { code?: string } } | undefined)?.error?.code
    : undefined

/**
 * The platform operations console (/platform-admin/*). Deliberately outside
 * `_authenticated` and `/o/{workspace}`: it has no workspace, no project
 * navigation and no realtime connection.
 *
 * This guard only decides which screen to show. Whether anything is answered
 * is decided by the API, which refuses everyone without platform access
 * (403 PLATFORM_ACCESS_REQUIRED) on every route, whatever this page does.
 */
export const Route = createFileRoute('/_platform')({
  beforeLoad: async ({ context }) => {
    const { auth } = useAuthStore.getState()
    if (!auth.user) {
      try {
        auth.setUser(await getMyProfile())
      } catch (error) {
        if (statusOf(error) === 401) {
          auth.reset()
          throw redirect({ to: '/sign-in' })
        }
        throw error
      }
    }
    try {
      await context.queryClient.fetchQuery({
        queryKey: PLATFORM_SESSION_KEY,
        queryFn: platformAdminApi.session,
        staleTime: 60_000,
      })
    } catch (error) {
      const status = statusOf(error)
      // The console needs a session that proved the second factor itself,
      // recently (domain architecture §21): an operator signed in to the
      // application without the code, or long ago, signs in again with it.
      if (status === 401 || codeOf(error) === 'PLATFORM_MFA_SESSION_REQUIRED') {
        await logout().catch(() => null)
        useAuthStore.getState().auth.reset()
        throw redirect({ to: '/sign-in', search: { redirect: '/platform-admin' } })
      }
      if (status === 403) throw redirect({ to: '/403' })
      throw error
    }
  },
  component: PlatformConsoleLayout,
  notFoundComponent: NotFoundError,
})
