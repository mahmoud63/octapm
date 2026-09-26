import { createFileRoute, redirect } from '@tanstack/react-router'

/** Canonical short link: `/vendors` opens the company registry at `/company/vendors` (Phase 22A). */
export const Route = createFileRoute('/_authenticated/o/$orgSlug/vendors')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/o/$orgSlug/company/vendors',
      params: { orgSlug: params.orgSlug },
      replace: true,
    })
  },
})
