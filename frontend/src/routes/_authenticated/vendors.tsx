import { createFileRoute, redirect } from '@tanstack/react-router'

/** Canonical short link: `/vendors` opens the company registry at `/company/vendors` (Phase 22A). */
export const Route = createFileRoute('/_authenticated/vendors')({
  beforeLoad: () => {
    throw redirect({ to: '/company/vendors', replace: true })
  },
})
