import { createFileRoute } from '@tanstack/react-router'
import { PlatformUsersPage } from '@/features/platform-admin/pages/users-page'

export const Route = createFileRoute('/_platform/platform-admin/users')({
  // `q` opens the list filtered — the platform search links a person here.
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search.q === 'string' && search.q ? { q: search.q.slice(0, 120) } : {},
  component: UsersRoute,
})

function UsersRoute() {
  const { q = '' } = Route.useSearch()
  return <PlatformUsersPage key={q} initialQ={q} />
}
