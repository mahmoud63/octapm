import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/company/')({
  component: function CompanyIndexRoute() {
    const { orgSlug } = Route.useParams()
    return (
      <Navigate
        to='/o/$orgSlug/company/directory'
        params={{ orgSlug }}
        replace
      />
    )
  },
})
