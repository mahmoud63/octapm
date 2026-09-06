import { createFileRoute } from '@tanstack/react-router'
import { TermsPage } from '@/features/legal/terms'

/**
 * Public: the sign-in page links here before anyone has an account, so it must
 * not sit behind authentication.
 */
export const Route = createFileRoute('/terms')({
  component: TermsPage,
})
