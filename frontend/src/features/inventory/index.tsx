import { useQuery } from '@tanstack/react-query'
import { Navigate } from '@tanstack/react-router'
import { useCanPerform } from '@/lib/permissions'
import { Main } from '@/components/layout/main'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getSummary } from './data/api'
import { AnalyticsPanel } from './components/analytics-panel'
import { GoodsReceiptPanel } from './components/goods-receipt-panel'
import { ItemsPanel } from './components/items-panel'
import { LedgerPanel } from './components/ledger-panel'
import { MatchPanel } from './components/match-panel'
import { ScanWorkspace } from './components/scan-workspace'
import { WarehousesPanel } from './components/warehouses-panel'

/**
 * The inventory and warehouse workspace.
 *
 * Company-level: a central store serves every project, and a storeman is not a
 * company administrator, so this sits beside Projects rather than inside the
 * admin-only Company section.
 *
 * Scanning opens first on purpose. It is what somebody standing in front of a
 * pallet with a phone actually wants, and everything else here is the desk view
 * of the same data.
 */
export function InventoryWorkspace() {
  const canRead = useCanPerform('inventory', 'read')
  const summary = useQuery({ queryKey: ['inventory', 'summary'], queryFn: getSummary })

  if (!canRead) return <Navigate to='/' replace />

  const figures = summary.data

  return (
    <Main>
      <div className='space-y-0.5'>
        <h1 className='font-display text-2xl font-bold tracking-tight md:text-3xl'>
          Inventory &amp; warehouse
        </h1>
        <p className='text-muted-foreground'>
          What the company holds, where it is, and what it cost — from goods in
          to the activity that consumed it.
        </p>
      </div>

      <div className='mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5'>
        {[
          ['Stock value', figures ? figures.totalValue.toLocaleString() : '—'],
          ['Items', figures ? String(figures.itemCount) : '—'],
          ['Below reorder', figures ? String(figures.lowStock) : '—'],
          ['Out of stock', figures ? String(figures.outOfStock) : '—'],
          ['Issued recently', figures ? figures.issuedValue.toLocaleString() : '—'],
        ].map(([label, value]) => (
          <div key={label} className='rounded-md border bg-card px-4 py-3'>
            <p className='text-[11px] tracking-wide text-muted-foreground uppercase'>
              {label}
            </p>
            <p className='font-display mt-1 text-xl font-bold tabular-nums'>{value}</p>
          </div>
        ))}
      </div>

      <Separator className='my-5' />

      <Tabs defaultValue='scan' className='space-y-4'>
        {/* Six tabs do not fit across a phone, and scanning happens on a phone. */}
        <TabsList className='h-auto flex-wrap' data-testid='uat-inventory-tabs'>
          <TabsTrigger value='scan'>Scan</TabsTrigger>
          <TabsTrigger value='receive'>Goods in</TabsTrigger>
          <TabsTrigger value='match'>Match</TabsTrigger>
          <TabsTrigger value='items'>Items</TabsTrigger>
          <TabsTrigger value='warehouses'>Warehouses</TabsTrigger>
          <TabsTrigger value='dashboard'>Dashboard</TabsTrigger>
          <TabsTrigger value='ledger'>Ledger</TabsTrigger>
        </TabsList>

        <TabsContent value='scan'>
          <ScanWorkspace />
        </TabsContent>
        <TabsContent value='receive'>
          <GoodsReceiptPanel />
        </TabsContent>
        <TabsContent value='match'>
          <MatchPanel />
        </TabsContent>
        <TabsContent value='items'>
          <ItemsPanel />
        </TabsContent>
        <TabsContent value='warehouses'>
          <WarehousesPanel />
        </TabsContent>
        <TabsContent value='dashboard'>
          <AnalyticsPanel />
        </TabsContent>
        <TabsContent value='ledger'>
          <LedgerPanel />
        </TabsContent>
      </Tabs>
    </Main>
  )
}
