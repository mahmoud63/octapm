import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/company/')({
  component: () => <Navigate to='/company/directory' replace />,
})
