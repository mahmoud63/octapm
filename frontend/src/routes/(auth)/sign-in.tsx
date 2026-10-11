import { z } from 'zod'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getMyProfile } from '@/services/auth/api'
import { useAuthStore } from '@/stores/auth-store'
import { safeInternalPath } from '@/lib/domains'
import { SignIn } from '@/features/auth/sign-in'

// Where to go after signing in: a path in this application only; anything
// else (another site, //host) is dropped (open-redirect protection).
const searchSchema = z.object({
  redirect: z
    .string()
    .optional()
    .transform((value) => safeInternalPath(value) ?? undefined),
})

export const Route = createFileRoute('/(auth)/sign-in')({
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
  component: SignIn,
  validateSearch: searchSchema,
})
