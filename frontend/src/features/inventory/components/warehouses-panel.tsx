import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Warehouse as WarehouseIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { listLocations, listWarehouses } from '../data/api'

const KIND_LABEL: Record<string, string> = {
  central: 'Central',
  project: 'Project',
  site: 'Site store',
  temporary: 'Temporary',
  equipment_yard: 'Equipment yard',
}

/** The stores, and the shelf structure inside whichever one is selected. */
export function WarehousesPanel() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const warehouses = useQuery({ queryKey: ['inventory', 'warehouses'], queryFn: listWarehouses })
  const active = selectedId ?? warehouses.data?.[0]?.id ?? null

  const locations = useQuery({
    queryKey: ['warehouse-locations', active],
    queryFn: () => listLocations(active!),
    enabled: Boolean(active),
  })

  return (
    <div className='grid gap-4 lg:grid-cols-[320px_1fr]' data-testid='uat-inventory-warehouses'>
      <div className='space-y-2'>
        {(warehouses.data ?? []).map((warehouse) => (
          <button
            key={warehouse.id}
            type='button'
            onClick={() => setSelectedId(warehouse.id)}
            className={cn(
              'w-full rounded-md border p-3 text-start transition-colors',
              warehouse.id === active ? 'border-interactive bg-selected' : 'hover:bg-surface'
            )}
            data-testid={`uat-warehouse-${warehouse.code}`}
          >
            <div className='flex items-center gap-2'>
              <WarehouseIcon className='size-4 shrink-0 text-interactive' />
              <span className='min-w-0 flex-1 truncate font-medium'>{warehouse.name}</span>
              <Badge variant='outline' className='shrink-0 text-[10px]'>
                {KIND_LABEL[warehouse.kind] ?? warehouse.kind}
              </Badge>
            </div>
            <p className='mt-1 font-mono text-[11px] text-muted-foreground'>
              {warehouse.code}
              {warehouse.locationCount != null
                ? ` · ${warehouse.locationCount} locations`
                : ''}
            </p>
          </button>
        ))}
        {warehouses.data?.length === 0 && (
          <p className='rounded-md border p-4 text-sm text-muted-foreground'>
            No warehouses yet.
          </p>
        )}
      </div>

      <Card className='octa-card-plain'>
        <CardHeader className='pb-3'>
          <CardTitle className='font-display text-base'>Locations</CardTitle>
        </CardHeader>
        <CardContent>
          {locations.data?.length ? (
            <ul className='space-y-1' data-testid='uat-warehouse-locations'>
              {locations.data.map((location) => (
                <li
                  key={location.id}
                  className='flex items-center gap-2 rounded-sm py-1 text-sm'
                  // Indent by depth, so the zone → aisle → rack → shelf → bin
                  // structure reads as the tree it is.
                  style={{ paddingInlineStart: location.depth * 18 }}
                >
                  <span className='w-16 shrink-0 text-[10px] tracking-wide text-muted-foreground uppercase'>
                    {location.kind}
                  </span>
                  <span className='font-mono text-xs'>{location.code}</span>
                  <span className='min-w-0 flex-1 truncate text-muted-foreground'>
                    {location.name}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-sm text-muted-foreground'>
              This warehouse has no zones or bins set up yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
