import { createFileRoute } from '@tanstack/react-router'
import { legacyWorkspaceRedirect } from '@/lib/workspace/legacy'

/**
 * `?tab=` lands on a particular workspace and `?orderRef=` names a delivery to
 * receive (OCTA-UX-RECEIPT-089). Legacy path: the same page under the active
 * workspace, `/o/{workspace}/inventory` (ENT-4).
 */
type InventorySearch = { tab?: string; orderRef?: string }

export const Route = createFileRoute('/_authenticated/inventory')({
  validateSearch: (search: Record<string, unknown>): InventorySearch => ({
    tab: typeof search.tab === 'string' ? search.tab : undefined,
    orderRef: typeof search.orderRef === 'string' ? search.orderRef : undefined,
  }),
  beforeLoad: legacyWorkspaceRedirect,
})
