import { createFileRoute, redirect } from '@tanstack/react-router'

/** Canonical short link: `/directory` opens the company registry at `/company/directory` (Phase 22A). */
export const Route = createFileRoute('/_authenticated/o/$orgSlug/directory')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/o/$orgSlug/company/directory',
      params: { orgSlug: params.orgSlug },
      replace: true,
    })
  },
})
