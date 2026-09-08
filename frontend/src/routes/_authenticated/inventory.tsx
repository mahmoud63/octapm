import { createFileRoute } from '@tanstack/react-router'
import { InventoryWorkspace } from '@/features/inventory'

/**
 * `?tab=` lands on a particular workspace and `?orderRef=` names a delivery to
 * receive, so Procurement can send a storeman straight to the goods-in screen
 * with the order already found instead of asking them to type its reference a
 * second time (OCTA-UX-RECEIPT-089).
 */
type InventorySearch = { tab?: string; orderRef?: string }

export const Route = createFileRoute('/_authenticated/inventory')({
  validateSearch: (search: Record<string, unknown>): InventorySearch => ({
    tab: typeof search.tab === 'string' ? search.tab : undefined,
    orderRef: typeof search.orderRef === 'string' ? search.orderRef : undefined,
  }),
  component: InventoryWorkspace,
})
