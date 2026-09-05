import { useMemo, useState } from 'react'
import { Eye, Plus } from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AuditHistoryPanel } from '@/features/audit/components/audit-history-panel'
import { useProject } from '@/features/projects/hooks/use-projects'
import {
  PAY_APP_STATUS_LABEL,
  usePayApps,
  type PayAppStatus,
} from '../hooks/use-pay-apps'
import { PayAppCreateDialog, PayAppDetailDialog } from './pay-app-dialogs'

const money = (currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    })
  } catch {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
  }
}

/**
 * Subcontractor payment applications (OCTA-FIN-SUBPAY-021): claims against
 * executed commitments, reviewed, approved and paid. A subcontractor party
 * sees the same page with only its own applications.
 */
export function PayAppsPanel({
  projectId,
  initialRecordId,
}: {
  projectId: string
  initialRecordId?: string | null
}) {
  const { data: project } = useProject(projectId)
  const formatter = useMemo(
    () => money(project?.currency || 'USD'),
    [project?.currency]
  )
  const formatMoney = (value: number) => formatter.format(Number(value) || 0)
  const canCreate = useCanPerform('sub_pay_app', 'create')
  const [status, setStatus] = useState<PayAppStatus | 'all'>('all')
  const { data, isLoading } = usePayApps(projectId, { status })
  const [createOpen, setCreateOpen] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [detailId, setDetailId] = useState<string | null>(
    initialRecordId ?? null
  )
  const items = data?.items ?? []
  const summary = data?.summary

  return (
    <div className='space-y-3' data-testid='uat-payapps-panel'>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-5'>
        {[
          ['Applications', summary?.total ?? 0, false],
          ['Awaiting review', summary?.submittedNet ?? 0, true],
          ['Approved net', summary?.approvedNet ?? 0, true],
          ['Paid', summary?.paid ?? 0, true],
          ['Outstanding', summary?.outstanding ?? 0, true],
        ].map(([label, value, isMoney]) => (
          <div key={label as string} className='rounded-lg border p-3'>
            <p className='text-xs text-muted-foreground'>{label as string}</p>
            <p className='text-lg font-semibold tabular-nums'>
              {isMoney ? formatMoney(value as number) : String(value)}
            </p>
          </div>
        ))}
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as PayAppStatus | 'all')}
        >
          <SelectTrigger className='w-44' aria-label='Status'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All statuses</SelectItem>
            {(Object.keys(PAY_APP_STATUS_LABEL) as PayAppStatus[]).map(
              (value) => (
                <SelectItem key={value} value={value}>
                  {PAY_APP_STATUS_LABEL[value]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
        {summary?.retentionHeld ? (
          <span className='text-xs text-muted-foreground'>
            Retention held {formatMoney(summary.retentionHeld)}
          </span>
        ) : null}
        {canCreate && (
          <Button
            size='sm'
            className='ml-auto'
            data-testid='uat-payapp-new'
            onClick={() => {
              setNonce((n) => n + 1)
              setCreateOpen(true)
            }}
          >
            <Plus className='mr-1 h-4 w-4' /> New application
          </Button>
        )}
      </div>
      {isLoading ? (
        <p className='py-6 text-center text-sm text-muted-foreground'>
          Loading applications…
        </p>
      ) : items.length === 0 ? (
        <p className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>
          No payment applications yet. Start one against an executed commitment.
        </p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full text-sm' data-testid='uat-payapp-list'>
            <thead className='bg-muted/40 text-xs'>
              <tr>
                <th className='p-2 text-left'>Ref</th>
                <th className='p-2 text-left'>Commitment</th>
                <th className='p-2 text-left'>Period</th>
                <th className='p-2 text-left'>Status</th>
                <th className='p-2 text-right'>Gross</th>
                <th className='p-2 text-right'>Retention</th>
                <th className='p-2 text-right'>Net</th>
                <th className='p-2 text-right'>Paid</th>
                <th className='p-2' />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className='border-t'
                  data-testid='uat-payapp-row'
                >
                  <td className='p-2 font-mono text-xs'>{item.ref}</td>
                  <td className='p-2'>
                    <div>{item.commitment?.title}</div>
                    <div className='text-xs text-muted-foreground'>
                      {item.commitment?.vendor?.name ?? '—'}
                    </div>
                  </td>
                  <td className='p-2'>{item.periodLabel}</td>
                  <td className='p-2'>
                    <Badge
                      variant={
                        item.status === 'paid' || item.status === 'approved'
                          ? 'default'
                          : item.status === 'rejected' || item.status === 'void'
                            ? 'destructive'
                            : 'outline'
                      }
                    >
                      {PAY_APP_STATUS_LABEL[item.status]}
                    </Badge>
                    {item.overClaimAmount > 0 && (
                      <span className='ml-1 text-xs text-destructive'>
                        over-claim
                      </span>
                    )}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(item.grossThisPeriod)}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(item.retentionThisPeriod)}
                  </td>
                  <td className='p-2 text-right font-medium tabular-nums'>
                    {formatMoney(item.netThisPeriod)}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(item.paidAmount)}
                  </td>
                  <td className='p-2 text-right'>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => setDetailId(item.id)}
                      data-testid='uat-payapp-open'
                    >
                      <Eye className='mr-1 h-4 w-4' /> Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AuditHistoryPanel
        projectId={projectId}
        entityType='sub_pay_app'
        title='Payment application history'
        limit={8}
      />
      {createOpen && (
        <PayAppCreateDialog
          key={nonce}
          projectId={projectId}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(created) => setDetailId(created.id)}
        />
      )}
      <PayAppDetailDialog
        projectId={projectId}
        payAppId={detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
        formatMoney={formatMoney}
      />
    </div>
  )
}
