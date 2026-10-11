import { createFileRoute } from '@tanstack/react-router'
import { currentSurface } from '@/lib/domains'
import { Dashboard } from '@/features/dashboard'
import { PortalHome } from '@/features/portal/portal-home'

// The workspace's front page: the company dashboard on the application, the
// person's project reviews on the External Collaboration Portal.
export const Route = createFileRoute('/_authenticated/o/$orgSlug/')({
  component: () => (currentSurface() === 'portal' ? <PortalHome /> : <Dashboard />),
})
