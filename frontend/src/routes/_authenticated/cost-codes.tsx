import { createFileRoute, redirect } from '@tanstack/react-router'

/** Canonical short link: `/cost-codes` opens the company registry at `/company/cost-codes` (Phase 22A). */
export const Route = createFileRoute('/_authenticated/cost-codes')({
  beforeLoad: () => {
    throw redirect({ to: '/company/cost-codes', replace: true })
  },
})
