import { createFileRoute, redirect } from '@tanstack/react-router'
import { getMyProfile } from '@/services/auth/api'
import { useAuthStore } from '@/stores/auth-store'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const { auth } = useAuthStore.getState()

    if (!auth.hasSession()) {
      throw redirect({
        to: '/landing',
      })
    }

    if (!auth.user) {
      try {
        const profile = await getMyProfile()
        auth.setUser(profile)
      } catch {
        auth.reset()
        throw redirect({
          to: '/landing',
        })
      }
    }
  },
  component: AuthenticatedLayout,
})
