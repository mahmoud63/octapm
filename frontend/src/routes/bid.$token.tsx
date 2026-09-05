import { createFileRoute } from '@tanstack/react-router'
import { BidderPortal } from '@/features/bids/portal/bidder-portal'

function BidderPortalRoute() {
  const { token } = Route.useParams()
  return <BidderPortal token={token} />
}

export const Route = createFileRoute('/bid/$token')({
  component: BidderPortalRoute,
})
