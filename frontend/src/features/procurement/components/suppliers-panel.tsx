import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { apiClient } from '@/services/api/client'
import { cn } from '@/lib/utils'

/**
 * The project's suppliers.
 *
 * A supplier record can point at an org-level vendor company, so its details
 * are entered once and reused on every project rather than re-keyed per order.
 */

type Supplier = {
  id: string
  code: string | null
  name: string
  companyId: string | null
  contactName: string | null
  email: string | null
  phone: string | null
  status: 'approved' | 'pending' | 'on_hold' | 'blocked'
  tradeCategories: unknown
  leadTimeReliability: number | null
  notes: string | null
}

const STATUS_TONE: Record<Supplier['status'], string> = {
  approved: 'bg-success/15 text-success-foreground',
  pending: 'bg-warning/15 text-warning-foreground',
  on_hold: 'bg-warning/15 text-warning-foreground',
  blocked: 'bg-error/15 text-error-foreground',
}

const STATUS_LABEL: Record<Supplier['status'], string> = {
  approved: 'Approved',
  pending: 'Pending',
  on_hold: 'On hold',
  blocked: 'Blocked',
}

const trades = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

export function SuppliersPanel({ projectId }: { projectId: string }) {
  const suppliers = useQuery({
    queryKey: ['procurement', projectId, 'suppliers'],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/procurement/suppliers`)
        .then((response) => response.data.data as Supplier[]),
    enabled: Boolean(projectId),
  })

  if (suppliers.isPending) {
    return (
      <div className='flex justify-center py-16'>
        <Loader2 className='size-6 animate-spin text-muted-foreground' />
      </div>
    )
  }

  const items = suppliers.data ?? []

  return (
    <div className='overflow-x-auto rounded-md border' data-testid='uat-procurement-suppliers'>
      <table className='w-full min-w-[760px] text-sm'>
        <thead className='bg-surface text-[11px] tracking-wide text-muted-foreground uppercase'>
          <tr>
            <th className='px-3 py-2 text-start'>Supplier</th>
            <th className='px-3 py-2 text-start'>Contact</th>
            <th className='px-3 py-2 text-start'>Trades</th>
            <th className='px-3 py-2 text-start'>Status</th>
            <th className='px-3 py-2 text-end'>Lead-time reliability</th>
          </tr>
        </thead>
        <tbody className='divide-y'>
          {items.map((supplier) => (
            <tr key={supplier.id} className='hover:bg-surface/60'>
              <td className='px-3 py-2'>
                <p className='font-medium'>{supplier.name}</p>
                <p className='font-mono text-[11px] text-muted-foreground'>
                  {supplier.code ?? '—'}
                  {supplier.companyId ? ' · company vendor' : ''}
                </p>
              </td>
              <td className='px-3 py-2 text-muted-foreground'>
                {supplier.contactName ?? '—'}
                {supplier.email && (
                  <span className='block text-[11px]'>{supplier.email}</span>
                )}
              </td>
              <td className='px-3 py-2 text-muted-foreground'>
                {trades(supplier.tradeCategories).join(', ') || '—'}
              </td>
              <td className='px-3 py-2'>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-medium',
                    STATUS_TONE[supplier.status]
                  )}
                >
                  {STATUS_LABEL[supplier.status]}
                </span>
              </td>
              <td className='px-3 py-2 text-end font-mono tabular-nums'>
                {supplier.leadTimeReliability === null
                  ? '—'
                  : `${Math.round(supplier.leadTimeReliability)}%`}
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={5} className='px-3 py-10 text-center text-muted-foreground'>
                No suppliers have been set up on this project.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
