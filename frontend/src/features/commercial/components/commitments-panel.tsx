import { BallInCourtBadge } from '@/components/ball-in-court'
import { useMemo, useState } from 'react'
import { Eye, Plus } from 'lucide-react'
import { FINANCIAL_TERMS } from '@/lib/financial-terms'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  COMMITMENT_STATUS_LABEL,
  useCommitments,
  type CommitmentListQuery,
  type CommitmentStatus,
  type CommitmentType,
} from '../hooks/use-commitments'
import {
  CommitmentCreateDialog,
  CommitmentDetailDialog,
} from './commitment-dialogs'

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
 * Commitments register (OCTA-FIN-COMMIT-020): subcontracts and purchase-order
 * commitments with their schedule of values, approval and execution.
 */
export function CommitmentsPanel({
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
  const canCreate = useCanPerform('commitment', 'create')
  const [type, setType] = useState<CommitmentType | 'all'>('all')
  const [status, setStatus] = useState<CommitmentStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const query: CommitmentListQuery = { type, status, search }
  const { data, isLoading } = useCommitments(projectId, query)
  const [createOpen, setCreateOpen] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [detailId, setDetailId] = useState<string | null>(
    initialRecordId ?? null
  )
  const items = data?.items ?? []
  const summary = data?.summary

  return (
    <div className='space-y-3' data-testid='uat-commitments-panel'>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-5'>
        {[
          ['Commitments', summary?.total ?? 0, false],
          ['Original', summary?.original ?? 0, true],
          ['Approved changes', summary?.approvedChanges ?? 0, true],
          ['Revised', summary?.revised ?? 0, true],
          [FINANCIAL_TERMS.executedCommitments.label, summary?.committed ?? 0, true],
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
        <Input
          placeholder='Search ref, title or vendor'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='max-w-xs'
        />
        <Select
          value={type}
          onValueChange={(value) => setType(value as CommitmentType | 'all')}
        >
          <SelectTrigger className='w-40' aria-label='Type'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All types</SelectItem>
            <SelectItem value='subcontract'>Subcontracts</SelectItem>
            <SelectItem value='purchase_order'>Purchase orders</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) =>
            setStatus(value as CommitmentStatus | 'all')
          }
        >
          <SelectTrigger className='w-44' aria-label='Status'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All statuses</SelectItem>
            {(Object.keys(COMMITMENT_STATUS_LABEL) as CommitmentStatus[]).map(
              (value) => (
                <SelectItem key={value} value={value}>
                  {COMMITMENT_STATUS_LABEL[value]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
        {canCreate && (
          <Button
            size='sm'
            className='ml-auto'
            data-testid='uat-commitment-new'
            onClick={() => {
              setNonce((n) => n + 1)
              setCreateOpen(true)
            }}
          >
            <Plus className='mr-1 h-4 w-4' /> New commitment
          </Button>
        )}
      </div>
      {isLoading ? (
        <p className='py-6 text-center text-sm text-muted-foreground'>
          Loading commitments…
        </p>
      ) : items.length === 0 ? (
        <p className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>
          No commitments yet. Issue a subcontract or a purchase-order commitment
          with its schedule of values.
        </p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full text-sm' data-testid='uat-commitment-list'>
            <thead className='bg-muted/40 text-xs'>
              <tr>
                <th className='p-2 text-left'>Ref</th>
                <th className='p-2 text-left'>Title</th>
                <th className='p-2 text-left'>Vendor</th>
                <th className='p-2 text-left'>Status</th>
                <th className='p-2 text-right'>Original</th>
                <th className='p-2 text-right'>Changes</th>
                <th className='p-2 text-right'>Revised</th>
                <th className='p-2 text-right'>Retention</th>
                <th className='p-2' />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className='border-t'
                  data-testid='uat-commitment-row'
                >
                  <td className='p-2 font-mono text-xs'>{item.ref}</td>
                  <td className='p-2'>
                    <div>{item.title}</div>
                    <div className='text-xs text-muted-foreground'>
                      {item.type === 'purchase_order'
                        ? 'Purchase order'
                        : 'Subcontract'}{' '}
                      · {item.lines.length} line
                      {item.lines.length === 1 ? '' : 's'}
                      {item.changeOrders.length
                        ? ` · ${item.changeOrders.length} CO`
                        : ''}
                    </div>
                  </td>
                  <td className='p-2'>{item.vendor?.name ?? '—'}</td>
                  <td className='p-2'>
                    <Badge
                      variant={
                        item.status === 'executed'
                          ? 'default'
                          : item.status === 'void'
                            ? 'destructive'
                            : 'outline'
                      }
                    >
                      {COMMITMENT_STATUS_LABEL[item.status]}
                    </Badge>
                    <BallInCourtBadge
                      ballInCourt={item.ballInCourt}
                      className='mt-1 flex w-fit'
                      testId={`uat-commitment-bic-${item.ref}`}
                    />
                    {item.status === 'approved' && !item.insuranceReady && (
                      <span className='ml-1 text-xs text-amber-600'>
                        insurance
                      </span>
                    )}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(item.original)}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(item.approvedChanges)}
                  </td>
                  <td className='p-2 text-right font-medium tabular-nums'>
                    {formatMoney(item.revised)}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {item.retentionRate}%
                  </td>
                  <td className='p-2 text-right'>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => setDetailId(item.id)}
                      data-testid='uat-commitment-open'
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
        entityType='commitment'
        title='Commitment history'
        limit={8}
      />
      {createOpen && (
        <CommitmentCreateDialog
          key={nonce}
          projectId={projectId}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(created) => setDetailId(created.id)}
          formatMoney={formatMoney}
        />
      )}
      <CommitmentDetailDialog
        projectId={projectId}
        commitmentId={detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
        formatMoney={formatMoney}
      />
    </div>
  )
}
