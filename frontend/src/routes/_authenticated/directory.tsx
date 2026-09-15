import { createFileRoute, redirect } from '@tanstack/react-router'

/** Canonical short link: `/directory` opens the company registry at `/company/directory` (Phase 22A). */
export const Route = createFileRoute('/_authenticated/directory')({
  beforeLoad: () => {
    throw redirect({ to: '/company/directory', replace: true })
  },
})
