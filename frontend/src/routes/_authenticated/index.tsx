import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'

/**
 * `/` is the identity's door (workspace switching doc §7): someone in one
 * workspace lands on its dashboard, `/o/{workspace}`; someone in several
 * lands on Home, which lists them with what needs them. No workspace to
 * open at all (an identity token) also lands on Home, which says so.
 */
export const Route = createFileRoute('/_authenticated/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    const active = auth.memberships.filter((entry) => entry.status === 'active')
    if (auth.workspace && active.length <= 1) {
      throw redirect({
        to: '/o/$orgSlug',
        params: { orgSlug: auth.workspace.segment },
        replace: true,
      })
    }
    throw redirect({ to: '/home', replace: true })
  },
})
