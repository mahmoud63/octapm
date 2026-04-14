import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useCertifyIpcPeriod,
  useCreateIpcPeriod,
  useIpcPeriod,
  useIpcPeriods,
  useSubmitIpcPeriod,
  useUpdateIpcItem,
} from '../hooks/use-commercial'

const fmtUSD = (value: number) =>
  '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

export function IpcWorkbook({ projectId }: { projectId: string }) {
  const { data: periods = [], isLoading } = useIpcPeriods(projectId)
  const createPeriod = useCreateIpcPeriod(projectId)
  const updateItem = useUpdateIpcItem(projectId)
  const submitPeriod = useSubmitIpcPeriod(projectId)
  const certifyPeriod = useCertifyIpcPeriod(projectId)

  const [selectedPeriod, setSelectedPeriod] = useState('')
  const activePeriod = selectedPeriod || periods[0]?.period || ''

  const { data: detail } = useIpcPeriod(projectId, activePeriod)

  const totals = useMemo(
    () => ({
      totalCert: detail?.totalCert || 0,
      totalRet: detail?.totalRet || 0,
      netPayable: detail?.netPayable || 0,
    }),
    [detail?.netPayable, detail?.totalCert, detail?.totalRet]
  )

  if (isLoading) {
    return (
      <p className='py-8 text-center text-muted-foreground'>
        Loading IPC data…
      </p>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-end justify-between gap-2'>
        <div className='space-y-1'>
          <p className='text-xs text-muted-foreground'>IPC Period</p>
          <select
            className='h-9 rounded-md border bg-background px-2 text-sm'
            value={activePeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
          >
            {periods.map((period) => (
              <option key={period.id} value={period.period}>
                {period.period} — {period.status}
              </option>
            ))}
          </select>
        </div>

        <div className='flex gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={createPeriod.isPending}
            onClick={async () => {
              try {
                const created = await createPeriod.mutateAsync({})
                setSelectedPeriod(created.period)
                toast.success(`Created ${created.period}`)
              } catch {
                toast.error('Failed to create IPC period')
              }
            }}
          >
            + New IPC Period
          </Button>

          {detail && detail.status === 'draft' && (
            <Button
              size='sm'
              onClick={async () => {
                try {
                  await submitPeriod.mutateAsync(activePeriod)
                  toast.success('IPC submitted')
                } catch {
                  toast.error('Failed to submit IPC')
                }
              }}
            >
              Submit IPC
            </Button>
          )}

          {detail && detail.status === 'submitted' && (
            <Button
              size='sm'
              onClick={async () => {
                try {
                  await certifyPeriod.mutateAsync(activePeriod)
                  toast.success('IPC certified')
                } catch {
                  toast.error('Failed to certify IPC')
                }
              }}
            >
              Certify IPC
            </Button>
          )}
        </div>
      </div>

      <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
        <div className='rounded-lg border p-3'>
          <p className='text-xs text-muted-foreground'>Total Certified</p>
          <p className='text-xl font-bold'>{fmtUSD(totals.totalCert)}</p>
        </div>
        <div className='rounded-lg border p-3'>
          <p className='text-xs text-muted-foreground'>Retention Held</p>
          <p className='text-xl font-bold text-amber-600'>
            {fmtUSD(totals.totalRet)}
          </p>
        </div>
        <div className='rounded-lg border p-3'>
          <p className='text-xs text-muted-foreground'>Net Payable</p>
          <p className='text-xl font-bold text-green-600'>
            {fmtUSD(totals.netPayable)}
          </p>
        </div>
      </div>

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm whitespace-nowrap'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left font-medium'>BOQ Ref</th>
              <th className='p-2 text-left font-medium'>Description</th>
              <th className='p-2 text-left font-medium'>Unit</th>
              <th className='p-2 text-right font-medium'>Total Qty</th>
              <th className='p-2 text-right font-medium'>Rate</th>
              <th className='p-2 text-right font-medium'>Previous Cert</th>
              <th className='p-2 text-right font-medium'>Current Qty</th>
              <th className='p-2 text-right font-medium'>Current Cert</th>
              <th className='p-2 text-right font-medium'>Cumulative</th>
              <th className='p-2 text-right font-medium'>Retention %</th>
              <th className='p-2 text-right font-medium'>Retention</th>
              <th className='p-2 text-right font-medium'>Net Payable</th>
            </tr>
          </thead>
          <tbody>
            {!detail || detail.items.length === 0 ? (
              <tr>
                <td
                  colSpan={12}
                  className='p-6 text-center text-muted-foreground'
                >
                  {activePeriod
                    ? 'No IPC items available for this period.'
                    : 'Create a new IPC period to start workbook entries.'}
                </td>
              </tr>
            ) : (
              detail.items.map((item) => (
                <tr key={item.id} className='border-b hover:bg-muted/25'>
                  <td className='p-2 font-mono text-xs'>
                    {item.boqItem.ref || '—'}
                  </td>
                  <td
                    className='max-w-80 truncate p-2'
                    title={item.boqItem.description}
                  >
                    {item.boqItem.description}
                  </td>
                  <td className='p-2 text-xs'>{item.boqItem.unit || '—'}</td>
                  <td className='p-2 text-right text-xs'>{item.boqItem.qty}</td>
                  <td className='p-2 text-right text-xs'>
                    {fmtUSD(item.rate)}
                  </td>
                  <td className='p-2 text-right text-xs'>
                    {fmtUSD(item.previousCert)}
                  </td>
                  <td className='p-2 text-right'>
                    <Input
                      type='number'
                      min={0}
                      className='h-8 w-24 text-right text-xs'
                      value={item.qty}
                      onChange={async (e) => {
                        try {
                          await updateItem.mutateAsync({
                            period: activePeriod,
                            itemId: item.id,
                            payload: { qty: Number(e.target.value) || 0 },
                          })
                        } catch {
                          toast.error('Failed to update quantity')
                        }
                      }}
                    />
                  </td>
                  <td className='p-2 text-right text-xs font-medium'>
                    {fmtUSD(item.currentCert)}
                  </td>
                  <td className='p-2 text-right text-xs'>
                    {fmtUSD(item.cumulativeCert)}
                  </td>
                  <td className='p-2 text-right'>
                    <Input
                      type='number'
                      min={0}
                      className='h-8 w-20 text-right text-xs'
                      value={item.retentionRate}
                      onChange={async (e) => {
                        try {
                          await updateItem.mutateAsync({
                            period: activePeriod,
                            itemId: item.id,
                            payload: {
                              retentionRate: Number(e.target.value) || 0,
                            },
                          })
                        } catch {
                          toast.error('Failed to update retention rate')
                        }
                      }}
                    />
                  </td>
                  <td className='p-2 text-right text-xs font-medium text-amber-700'>
                    {fmtUSD(item.retention)}
                  </td>
                  <td className='p-2 text-right text-xs font-semibold text-green-700'>
                    {fmtUSD(item.netPayable)}
                  </td>
                </tr>
              ))
            )}
          </tbody>

          {detail && detail.items.length > 0 && (
            <tfoot>
              <tr className='bg-muted/40'>
                <td
                  colSpan={7}
                  className='p-2 text-right text-xs font-semibold'
                >
                  Totals:
                </td>
                <td className='p-2 text-right text-xs font-semibold'>
                  {fmtUSD(totals.totalCert)}
                </td>
                <td className='p-2' />
                <td className='p-2' />
                <td className='p-2 text-right text-xs font-semibold'>
                  {fmtUSD(totals.totalRet)}
                </td>
                <td className='p-2 text-right text-xs font-semibold'>
                  {fmtUSD(totals.netPayable)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
