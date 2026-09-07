import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PurchaseOrdersPanel } from './purchase-orders-panel'
import { SuppliersPanel } from './suppliers-panel'

/**
 * Procurement.
 *
 * The module has been backend-only until now: purchase orders, suppliers and
 * lead-time alerts existed over the API with nothing to look at (GAP-UI-001).
 */
export function ProcurementDashboard({
  projectId,
  activeTab,
  onTabChange,
  showTabList = true,
  initialOrderId,
}: {
  projectId: string
  activeTab?: string
  onTabChange?: (value: string) => void
  showTabList?: boolean
  initialOrderId?: string
}) {
  const tabsProps =
    activeTab !== undefined
      ? { value: activeTab, onValueChange: onTabChange }
      : { defaultValue: 'purchase-orders' }

  return (
    <Tabs {...tabsProps} className='space-y-3'>
      {showTabList && (
        <TabsList className='h-auto flex-wrap'>
          <TabsTrigger value='purchase-orders'>Purchase Orders</TabsTrigger>
          <TabsTrigger value='suppliers'>Suppliers</TabsTrigger>
        </TabsList>
      )}

      <TabsContent value='purchase-orders'>
        <PurchaseOrdersPanel projectId={projectId} initialOrderId={initialOrderId} />
      </TabsContent>

      <TabsContent value='suppliers'>
        <SuppliersPanel projectId={projectId} />
      </TabsContent>
    </Tabs>
  )
}
