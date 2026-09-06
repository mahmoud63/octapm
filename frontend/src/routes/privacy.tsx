import { createFileRoute } from '@tanstack/react-router'
import { PrivacyPage } from '@/features/legal/privacy'

/** Public, for the same reason as /terms. */
export const Route = createFileRoute('/privacy')({
  component: PrivacyPage,
})
