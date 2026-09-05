import { createFileRoute } from '@tanstack/react-router'
import { RfqPortal } from '@/features/change-events/portal/rfq-portal'

function RfqPortalRoute() {
  const { token } = Route.useParams()
  return <RfqPortal token={token} />
}

export const Route = createFileRoute('/rfq/$token')({
  component: RfqPortalRoute,
})
