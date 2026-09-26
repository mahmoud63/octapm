import { createFileRoute, redirect } from '@tanstack/react-router'

/** Canonical short link: `/cost-codes` opens the company registry at `/company/cost-codes` (Phase 22A). */
export const Route = createFileRoute('/_authenticated/o/$orgSlug/cost-codes')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/o/$orgSlug/company/cost-codes',
      params: { orgSlug: params.orgSlug },
      replace: true,
    })
  },
})
