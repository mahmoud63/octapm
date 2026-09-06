import { createFileRoute } from '@tanstack/react-router'
import { SsoComplete } from '@/features/auth/sso-complete'

export const Route = createFileRoute('/(auth)/sso/complete')({
  component: SsoComplete,
})
