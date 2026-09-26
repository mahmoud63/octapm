import { createFileRoute } from '@tanstack/react-router'
import { legacyWorkspaceRedirect } from '@/lib/workspace/legacy'

type CheckoutSearch = { plan: 'individual' | 'business' }

/** Legacy path: the same page under the active workspace, `/o/{workspace}/billing/checkout` (ENT-4). */
export const Route = createFileRoute('/_authenticated/billing/checkout')({
  validateSearch: (search: Record<string, unknown>): CheckoutSearch => ({
    plan: search.plan === 'business' ? 'business' : 'individual',
  }),
  beforeLoad: legacyWorkspaceRedirect,
})
