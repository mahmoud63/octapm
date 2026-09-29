import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ESTABLISHED_VALUE_SOURCES,
  useClientStatement,
  usePrimeContract,
  useReceivables,
  useUpdatePrimeContract,
  type StatementLine,
  type ValueWithheld,
} from '../hooks/use-prime-contract'
import { ContractTermsDialog, RecordAdvanceDialog } from './client-billing-dialogs'

/**
 * Client billing — money coming in.
 *
 * The summary block is the front page of a payment application, in the order
 * every standard form uses: what was agreed, what the changes did to it, what
 * has been certified before, what is claimed now, and what the client owes
 * once retention, the advance, deductions and tax have been applied.
 *
 * Below it, the same story per BOQ line — contract, previous, this period,
 * total, remaining. That is the table a QS reads first and the one every
 * dispute starts from.
 */

const money = (value: number, currency = 'USD') =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value || 0)

const exact = (value: number) =>
  (value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

/** One line of the summary block. Negative rows are what is being withheld. */
function Row({
  label,
  value,
  hint,
  negative = false,
  strong = false,
  rule = false,
}: {
  label: string
  value: number
  hint?: string
  negative?: boolean
  strong?: boolean
  rule?: boolean
}) {
  if (!strong && !negative && !value && !hint) return null
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-1.5',
        rule && 'border-t mt-1 pt-2',
        strong && 'font-semibold'
      )}
    >
      <span className={cn('text-sm', !strong && 'text-muted-foreground')}>
        {label}
        {hint && <span className='ms-1.5 text-[11px] opacity-70'>{hint}</span>}
      </span>
      <span
        className={cn(
          'font-mono text-sm tabular-nums',
          strong && 'text-base',
          negative && value > 0 && 'text-error-foreground'
        )}
      >
        {negative && value > 0 ? `(${exact(value)})` : exact(value)}
      </span>
    </div>
  )
}

/**
 * A figure the server withheld: "—" and the server's reason, never a zero
 * (utils/boq-figures on the server decides; the page only shows it).
 */
function Withheld({ reason }: { reason: string }) {
  return (
    <span className='inline-flex flex-col' data-testid='uat-contract-value-withheld'>
      <span className='font-mono'>—</span>
      <span className='text-[11px] font-normal text-muted-foreground'>{reason}</span>
    </span>
  )
}

const withheldKey = (withheld: ValueWithheld | undefined, key: string) =>
  withheld?.keys.includes(key) ? withheld : null

export function ClientBillingPanel({ projectId }: { projectId: string }) {
  const [termsOpen, setTermsOpen] = useState(false)
  const [advanceOpen, setAdvanceOpen] = useState(false)

  const contract = usePrimeContract(projectId)
  const statement = useClientStatement(projectId)
  const receivables = useReceivables(projectId)

  const canManage = useCanPerform('ipc', 'update', 'contract.manage')
  const canRecordAdvance = useCanPerform('ipc', 'create', 'advance.record')
  const update = useUpdatePrimeContract(projectId)

  if (statement.isPending || contract.isPending) {
    return (
      <div className='flex justify-center py-16'>
        <Loader2 className='size-6 animate-spin text-muted-foreground' />
      </div>
    )
  }
  if (!statement.data || !contract.data) {
    return (
      <p className='py-10 text-center text-sm text-muted-foreground'>
        The client contract could not be loaded.
      </p>
    )
  }

  const { summary, current, linesWithheld } = statement.data
  // A member who may not read the BOQ is sent no line: the server withholds
  // the rows and says why, and the table says so instead of showing any.
  const lines = statement.data.lines ?? []
  const c = contract.data
  const ar = receivables.data
  // The original value is established (the project's own, or entered or
  // confirmed under the contract) or it is the BOQ's total nobody has
  // confirmed. The server withholds the latter from a member who may not
  // read the BOQ; one who may, and who manages the contract, may confirm it.
  const unconfirmed = !ESTABLISHED_VALUE_SOURCES.includes(c.originalValueSource)
  const canConfirm = canManage && unconfirmed && !c.valueWithheld
  const advanceWithheld = withheldKey(summary.valueWithheld, 'advanceAmount')
  const hasAdvance = (c.advanceAmount ?? 0) > 0 || Boolean(advanceWithheld)
  const confirm = () =>
    update.mutate(
      { confirmOriginalValue: true },
      {
        onSuccess: () => toast.success('Original value confirmed as the contract value'),
        onError: (error) => toast.error(getServerErrorMessage(error)),
      }
    )

  return (
    <div className='space-y-4' data-testid='uat-client-billing'>
      {/* ── the contract ── */}
      <Card className='octa-card-plain' data-testid='uat-contract-card'>
        <CardHeader className='pb-3'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div>
              <CardTitle className='font-display text-lg'>{c.title}</CardTitle>
              <p className='text-sm text-muted-foreground'>
                <span className='font-mono'>{c.ref}</span>
                {c.client ? ` · ${c.client}` : ''} · {c.paymentTermsDays} day terms
              </p>
            </div>
            <div className='flex gap-2'>
              {canRecordAdvance && hasAdvance && (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setAdvanceOpen(true)}
                  data-testid='uat-contract-advance'
                >
                  Record advance
                </Button>
              )}
              {canManage && (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setTermsOpen(true)}
                  data-testid='uat-contract-terms'
                >
                  Contract terms
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
            {(
              [
                ['Original contract', 'originalValue', summary.originalValue],
                ['Approved changes', 'approvedChangesValue', summary.approvedChangesValue],
                ['Revised contract', 'revisedValue', summary.revisedValue],
                ['Remaining to certify', 'remainingToCertify', summary.remainingToCertify],
              ] as const
            ).map(([label, key, value]) => {
              const withheld = withheldKey(summary.valueWithheld, key)
              return (
                <div key={key} className='rounded-md border px-3 py-2'>
                  <p className='text-[11px] tracking-wide text-muted-foreground uppercase'>
                    {label}
                  </p>
                  <p className='font-display mt-0.5 text-lg font-bold tabular-nums'>
                    {withheld ? <Withheld reason={withheld.reason} /> : money(value ?? 0, c.currency)}
                  </p>
                </div>
              )
            })}
          </div>
          {unconfirmed && !c.valueWithheld && (
            <div
              className='mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-warning-foreground'
              data-testid='uat-contract-value-unconfirmed'
            >
              <span>
                {c.originalValueSource === 'boq_fallback'
                  ? 'The original value is the BOQ total, taken because the project had no contract value. It is not yet confirmed as the contract value, so members who may not read the BOQ do not see it.'
                  : 'Where the original value came from is not established, so members who may not read the BOQ do not see it.'}
              </span>
              {canConfirm && (
                <Button
                  variant='outline'
                  size='sm'
                  disabled={update.isPending}
                  onClick={confirm}
                  data-testid='uat-contract-value-confirm'
                >
                  {update.isPending && <Loader2 className='me-1.5 size-4 animate-spin' />}
                  Confirm as contract value
                </Button>
              )}
            </div>
          )}
          {summary.pendingChangesValue > 0 && (
            <p className='mt-2 text-xs text-warning-foreground'>
              {money(summary.pendingChangesValue, c.currency)} of change orders are
              raised but not approved, and are not in the revised value.
            </p>
          )}
        </CardContent>
      </Card>

      <div className='grid gap-4 lg:grid-cols-2'>
        {/* ── this application ── */}
        <Card className='octa-card-plain' data-testid='uat-application-summary'>
          <CardHeader className='pb-2'>
            <div className='flex items-baseline justify-between gap-2'>
              <CardTitle className='font-display text-base'>
                {current ? `Application ${current.period}` : 'Application'}
              </CardTitle>
              {current && (
                <span className='text-xs text-muted-foreground capitalize'>
                  {current.status}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className='pt-0'>
            {current ? (
              <div className='divide-y-0'>
                <Row label='Previously certified' value={summary.previousCertified} strong />
                <Row label='Work this period' value={summary.currentCertified} strong />
                <Row
                  label='Materials on site'
                  value={summary.materialsOnSite}
                  hint={
                    c.materialsOnSiteRate < 100 ? `at ${c.materialsOnSiteRate}%` : undefined
                  }
                />
                <Row label='Gross this period' value={summary.grossThisPeriod} strong rule />
                <Row
                  label='Retention'
                  value={summary.retentionThisPeriod}
                  hint={
                    c.retentionCapRate
                      ? `${c.retentionRate}%, capped at ${c.retentionCapRate}%`
                      : `${c.retentionRate}%`
                  }
                  negative
                />
                <Row
                  label='Advance recovery'
                  value={summary.advanceRecoveryThisPeriod}
                  hint={c.advanceRecoveryRate ? `${c.advanceRecoveryRate}% of gross` : undefined}
                  negative
                />
                <Row
                  label='Deductions'
                  value={summary.deductions}
                  hint={current.deductionsNote ?? undefined}
                  negative
                />
                <Row
                  label='Tax'
                  value={summary.taxAmount}
                  hint={summary.taxRate ? `${summary.taxRate}%` : undefined}
                />
                <Row label='Total due' value={summary.totalDue} strong rule />
                <Row label='Received' value={current.amountPaid} />
                <Row label='Outstanding' value={current.balanceDue} strong />
              </div>
            ) : (
              <p className='py-6 text-center text-sm text-muted-foreground'>
                No payment application has been raised yet.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── what the client owes ── */}
        <Card className='octa-card-plain' data-testid='uat-receivables'>
          <CardHeader className='pb-2'>
            <CardTitle className='font-display text-base'>Accounts receivable</CardTitle>
            <p className='text-xs text-muted-foreground'>
              Invoiced against received, aged from the invoice due date.
            </p>
          </CardHeader>
          <CardContent className='pt-0'>
            <div className='grid grid-cols-3 gap-3'>
              {[
                ['Invoiced', ar?.invoiced ?? 0],
                ['Received', ar?.received ?? 0],
                ['Outstanding', ar?.outstanding ?? 0],
              ].map(([label, value]) => (
                <div key={label as string} className='rounded-md border px-3 py-2'>
                  <p className='text-[11px] tracking-wide text-muted-foreground uppercase'>
                    {label}
                  </p>
                  <p className='font-display mt-0.5 text-base font-bold tabular-nums'>
                    {money(value as number, c.currency)}
                  </p>
                </div>
              ))}
            </div>

            <ul className='mt-3 space-y-1.5'>
              {(ar?.ageing ?? []).map((bucket) => (
                <li key={bucket.key} className='flex items-center gap-2'>
                  <span className='w-24 shrink-0 text-xs text-muted-foreground'>
                    {bucket.label}
                  </span>
                  <div className='h-1.5 flex-1 overflow-hidden rounded-full bg-surface'>
                    <div
                      className={cn(
                        'h-full rounded-full',
                        bucket.key === 'current' ? 'bg-brand-accent' : 'bg-error'
                      )}
                      style={{
                        width: `${
                          ar && ar.outstanding > 0
                            ? Math.max((bucket.amount / ar.outstanding) * 100, bucket.amount ? 2 : 0)
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  <span className='w-28 shrink-0 text-end font-mono text-xs tabular-nums'>
                    {exact(bucket.amount)}
                  </span>
                </li>
              ))}
            </ul>

            {(ar?.overdue ?? 0) > 0 && (
              <p className='mt-3 text-xs text-error-foreground' data-testid='uat-ar-overdue'>
                {money(ar!.overdue, c.currency)} is past its due date.
              </p>
            )}

            {hasAdvance && (
              <div className='mt-4 rounded-md border px-3 py-2' data-testid='uat-advance-state'>
                <p className='text-[11px] tracking-wide text-muted-foreground uppercase'>
                  Advance payment
                </p>
                <div className='mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm'>
                  <span>
                    Agreed{' '}
                    {advanceWithheld ? (
                      <Withheld reason={advanceWithheld.reason} />
                    ) : (
                      <span className='font-mono tabular-nums'>{exact(summary.advanceAmount ?? 0)}</span>
                    )}
                  </span>
                  <span>
                    Received{' '}
                    <span className='font-mono tabular-nums'>{exact(summary.advancePaid)}</span>
                  </span>
                  <span>
                    Recovered{' '}
                    <span className='font-mono tabular-nums'>
                      {exact(summary.advanceRecoveredToDate)}
                    </span>
                  </span>
                  <span className='font-medium'>
                    Outstanding{' '}
                    <span className='font-mono tabular-nums'>
                      {exact(summary.advanceOutstanding)}
                    </span>
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── the schedule of values ── */}
      <Card className='octa-card-plain' data-testid='uat-contract-sov'>
        <CardHeader className='pb-2'>
          <CardTitle className='font-display text-base'>Schedule of values</CardTitle>
          <p className='text-xs text-muted-foreground'>
            The BOQ, measured. Contract, previously certified, this period, and what is
            left.
          </p>
        </CardHeader>
        <CardContent className='pt-0'>
          <div className='overflow-x-auto rounded-md border'>
            <table className='w-full min-w-[820px] text-sm'>
              <thead className='bg-surface text-[11px] tracking-wide text-muted-foreground uppercase'>
                <tr>
                  <th className='px-3 py-2 text-start'>Description</th>
                  <th className='px-3 py-2 text-end'>Contract</th>
                  <th className='px-3 py-2 text-end'>Previous</th>
                  <th className='px-3 py-2 text-end'>This period</th>
                  <th className='px-3 py-2 text-end'>Total</th>
                  <th className='px-3 py-2 text-end'>Remaining</th>
                  <th className='px-3 py-2 text-end'>%</th>
                </tr>
              </thead>
              <tbody className='divide-y'>
                {lines.map((line: StatementLine) => (
                  <tr key={line.boqItemId}>
                    <td className='px-3 py-2'>
                      <p className='font-medium'>{line.description}</p>
                      <p className='font-mono text-[11px] text-muted-foreground'>
                        {line.code}
                        {line.unit ? ` · ${line.quantity} ${line.unit} @ ${line.rate}` : ''}
                      </p>
                    </td>
                    <td className='px-3 py-2 text-end font-mono tabular-nums'>
                      {exact(line.contractAmount)}
                    </td>
                    <td className='px-3 py-2 text-end font-mono tabular-nums'>
                      {exact(line.previous)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-end font-mono tabular-nums',
                        line.thisPeriod > 0 && 'font-semibold'
                      )}
                    >
                      {exact(line.thisPeriod)}
                    </td>
                    <td className='px-3 py-2 text-end font-mono tabular-nums'>
                      {exact(line.total)}
                    </td>
                    <td className='px-3 py-2 text-end font-mono tabular-nums'>
                      {exact(line.remaining)}
                    </td>
                    <td className='px-3 py-2 text-end font-mono tabular-nums text-muted-foreground'>
                      {line.pctComplete}%
                    </td>
                  </tr>
                ))}
                {linesWithheld && (
                  <tr data-testid='uat-contract-sov-withheld'>
                    <td colSpan={7} className='px-3 py-8 text-center text-muted-foreground'>
                      <p className='font-mono'>—</p>
                      <p>{linesWithheld.reason}</p>
                    </td>
                  </tr>
                )}
                {!linesWithheld && lines.length === 0 && (
                  <tr>
                    <td colSpan={7} className='px-3 py-8 text-center text-muted-foreground'>
                      The BOQ is empty, so there is nothing to certify against.
                    </td>
                  </tr>
                )}
              </tbody>
              {lines.length > 0 && (
                <tfoot className='border-t-2 bg-surface font-semibold'>
                  <tr>
                    <td className='px-3 py-2'>Total</td>
                    <td className='px-3 py-2 text-end font-mono tabular-nums'>
                      {exact(lines.reduce((sum, line) => sum + line.contractAmount, 0))}
                    </td>
                    <td className='px-3 py-2 text-end font-mono tabular-nums'>
                      {exact(lines.reduce((sum, line) => sum + line.previous, 0))}
                    </td>
                    <td className='px-3 py-2 text-end font-mono tabular-nums'>
                      {exact(lines.reduce((sum, line) => sum + line.thisPeriod, 0))}
                    </td>
                    <td className='px-3 py-2 text-end font-mono tabular-nums'>
                      {exact(lines.reduce((sum, line) => sum + line.total, 0))}
                    </td>
                    <td className='px-3 py-2 text-end font-mono tabular-nums'>
                      {exact(lines.reduce((sum, line) => sum + line.remaining, 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      <ContractTermsDialog
        projectId={projectId}
        contract={c}
        open={termsOpen}
        onOpenChange={setTermsOpen}
      />
      <RecordAdvanceDialog
        projectId={projectId}
        contract={c}
        open={advanceOpen}
        onOpenChange={setAdvanceOpen}
      />
    </div>
  )
}
