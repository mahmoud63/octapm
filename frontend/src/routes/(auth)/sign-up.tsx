import { createFileRoute, redirect } from '@tanstack/react-router'
import { getMyProfile } from '@/services/auth/api'
import { useAuthStore } from '@/stores/auth-store'
import { SignUp } from '@/features/auth/sign-up'

export const Route = createFileRoute('/(auth)/sign-up')({
  beforeLoad: async () => {
    const { auth } = useAuthStore.getState()

    if (!auth.user) {
      try {
        const profile = await getMyProfile()
        auth.setUser(profile)
      } catch {
        auth.reset()
        return
      }
    }

    throw redirect({ to: '/' })
  },
  component: SignUp,
})
