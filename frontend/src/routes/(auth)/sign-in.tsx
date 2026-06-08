import { z } from 'zod'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getMyProfile } from '@/services/auth/api'
import { useAuthStore } from '@/stores/auth-store'
import { SignIn } from '@/features/auth/sign-in'

const searchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/sign-in')({
  beforeLoad: async () => {
    const { auth } = useAuthStore.getState()

    if (!auth.hasSession()) {
      return
    }

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
  component: SignIn,
  validateSearch: searchSchema,
})
