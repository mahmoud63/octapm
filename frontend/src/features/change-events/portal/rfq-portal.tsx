import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CHANGE_EVENT_TYPE_LABEL } from '../hooks/use-change-events'
import {
  useRfqPortalDecline,
  useRfqPortalQuote,
  useRfqPortalView,
  type RfqPortalView,
} from './use-rfq-portal'

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : '—'
const formatMoney = (value: number, currency: string | null) =>
  `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`

function QuoteForm({ token, view }: { token: string; view: RfqPortalView }) {
  const quote = useRfqPortalQuote(token)
  const decline = useRfqPortalDecline(token)
  const [amounts, setAmounts] = useState<
    Record<string, { amount: string; note: string }>
  >(() =>
    Object.fromEntries(
      view.changeEvent.lines.map((line) => {
        const existing = view.quote.lines.find(
          (item) => item.lineId === line.id
        )
        return [
          line.id,
          {
            amount:
              existing?.amount === null || existing?.amount === undefined
                ? ''
                : String(existing.amount),
            note: existing?.note ?? '',
          },
        ]
      })
    )
  )
  const [meta, setMeta] = useState({
    notes: view.quote.notes ?? '',
    validUntil: view.quote.validUntil?.slice(0, 10) ?? '',
    leadTimeDays: view.quote.leadTimeDays?.toString() ?? '',
    quotedBy: view.quote.quotedBy ?? view.rfq.contactName ?? '',
  })
  const editable = view.rfq.acceptingQuotes
  const total = view.changeEvent.lines.reduce((sum, line) => {
    const value = amounts[line.id]?.amount.replace(/,/g, '')
    return value === '' || value === undefined ? sum : sum + Number(value)
  }, 0)
  const priced = view.changeEvent.lines.filter(
    (line) => amounts[line.id]?.amount !== ''
  )

  const submit = async () => {
    if (!priced.length) {
      toast.error('Enter an amount for at least one line')
      return
    }
    try {
      await quote.mutateAsync({
        lines: view.changeEvent.lines.map((line) => ({
          lineId: line.id,
          amount:
            amounts[line.id]?.amount === '' ? null : amounts[line.id]?.amount,
          note: amounts[line.id]?.note || null,
        })),
        notes: meta.notes || null,
        validUntil: meta.validUntil || null,
        leadTimeDays:
          meta.leadTimeDays === '' ? null : Number(meta.leadTimeDays),
        quotedBy: meta.quotedBy || null,
      })
      toast.success('Quotation sent — thank you')
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <section className='space-y-3' data-testid='uat-rfq-portal-form'>
      <h2 className='text-lg font-semibold'>Your quotation</h2>
      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50 text-xs text-muted-foreground'>
            <tr>
              <th className='px-2 py-1 text-left'>Scope</th>
              <th className='px-2 py-1 text-right'>Qty</th>
              <th className='px-2 py-1 text-left'>Unit</th>
              <th className='px-2 py-1 text-right'>Your price</th>
              <th className='px-2 py-1 text-left'>Note</th>
            </tr>
          </thead>
          <tbody>
            {view.changeEvent.lines.map((line) => (
              <tr key={line.id} className='border-t align-top'>
                <td className='px-2 py-1'>
                  <div>{line.description}</div>
                  {(line.activity || line.notes) && (
                    <div className='text-xs text-muted-foreground'>
                      {[line.activity, line.notes].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {line.quantity}
                </td>
                <td className='px-2 py-1'>{line.unit ?? ''}</td>
                <td className='px-2 py-1 text-right'>
                  <Input
                    type='text'
                    inputMode='decimal'
                    className='h-8 w-32 text-right'
                    value={amounts[line.id]?.amount ?? ''}
                    disabled={!editable}
                    onChange={(event) =>
                      setAmounts((current) => ({
                        ...current,
                        [line.id]: {
                          ...current[line.id],
                          amount: event.target.value,
                        },
                      }))
                    }
                    data-testid='uat-rfq-portal-amount'
                  />
                </td>
                <td className='px-2 py-1'>
                  <Input
                    className='h-8 w-44'
                    value={amounts[line.id]?.note ?? ''}
                    disabled={!editable}
                    onChange={(event) =>
                      setAmounts((current) => ({
                        ...current,
                        [line.id]: {
                          ...current[line.id],
                          note: event.target.value,
                        },
                      }))
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className='bg-muted/30 font-medium'>
            <tr>
              <td className='px-2 py-1' colSpan={3}>
                Total
              </td>
              <td className='px-2 py-1 text-right tabular-nums'>
                {formatMoney(total, view.changeEvent.currency)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className='grid gap-3 sm:grid-cols-3'>
        <div className='space-y-1'>
          <Label>Valid until</Label>
          <Input
            type='date'
            value={meta.validUntil}
            disabled={!editable}
            onChange={(event) =>
              setMeta({ ...meta, validUntil: event.target.value })
            }
          />
        </div>
        <div className='space-y-1'>
          <Label>Lead time (days)</Label>
          <Input
            type='number'
            min={0}
            value={meta.leadTimeDays}
            disabled={!editable}
            onChange={(event) =>
              setMeta({ ...meta, leadTimeDays: event.target.value })
            }
          />
        </div>
        <div className='space-y-1'>
          <Label>Your name</Label>
          <Input
            value={meta.quotedBy}
            disabled={!editable}
            onChange={(event) =>
              setMeta({ ...meta, quotedBy: event.target.value })
            }
          />
        </div>
        <div className='space-y-1 sm:col-span-3'>
          <Label>Inclusions, exclusions, notes</Label>
          <Textarea
            rows={3}
            value={meta.notes}
            disabled={!editable}
            onChange={(event) =>
              setMeta({ ...meta, notes: event.target.value })
            }
          />
        </div>
      </div>
      {editable ? (
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            disabled={quote.isPending}
            onClick={submit}
            data-testid='uat-rfq-portal-submit'
          >
            {quote.isPending && (
              <Loader2 className='mr-1 h-4 w-4 animate-spin' />
            )}
            {view.rfq.status === 'quoted'
              ? 'Update quotation'
              : 'Send quotation'}
          </Button>
          <Button
            variant='ghost'
            className='ml-auto'
            disabled={decline.isPending}
            onClick={async () => {
              const reason = window.prompt(
                'Decline to quote? Reason (optional):'
              )
              if (reason === null) return
              try {
                await decline.mutateAsync({ reason: reason || null })
                toast.success('Declined')
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            Decline to quote
          </Button>
        </div>
      ) : (
        <p className='text-sm text-muted-foreground'>
          {view.rfq.status === 'accepted'
            ? 'Your quotation was accepted — thank you.'
            : view.rfq.status === 'rejected'
              ? 'Your quotation was not selected this time.'
              : view.rfq.status === 'declined'
                ? 'You declined to quote.'
                : 'This request is no longer taking quotations.'}
        </p>
      )}
      {view.quote.quotedAt && (
        <p className='text-xs text-muted-foreground'>
          Last sent {new Date(view.quote.quotedAt).toLocaleString()}
          {view.quote.quotedBy ? ` by ${view.quote.quotedBy}` : ''}.
        </p>
      )}
    </section>
  )
}

/** Public page `/rfq/$token`: one vendor's request for quotation. */
export function RfqPortal({ token }: { token: string }) {
  const { data: view, isLoading, error } = useRfqPortalView(token)
  if (isLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center text-sm text-muted-foreground'>
        <Loader2 className='mr-2 h-4 w-4 animate-spin' /> Opening your request…
      </div>
    )
  }
  if (error || !view) {
    return (
      <div className='mx-auto max-w-lg space-y-2 px-4 py-16 text-center'>
        <h1 className='text-xl font-semibold'>
          This quotation link cannot be opened
        </h1>
        <p className='text-sm text-muted-foreground'>
          {getServerErrorMessage(error)}
        </p>
        <p className='text-sm text-muted-foreground'>
          Links expire and are replaced by the latest email you received; ask
          the project team for a new request.
        </p>
      </div>
    )
  }
  const { changeEvent, rfq } = view
  return (
    <div
      className='mx-auto max-w-4xl space-y-6 px-4 py-8'
      data-testid='uat-rfq-portal'
    >
      <header className='space-y-1'>
        <p className='text-xs tracking-wide text-muted-foreground uppercase'>
          Request for quotation · {rfq.companyName}
        </p>
        <h1 className='text-2xl font-semibold'>
          {changeEvent.ref} · {changeEvent.title}
        </h1>
        <p className='text-sm text-muted-foreground'>
          {changeEvent.projectName ? `${changeEvent.projectName} · ` : ''}
          {CHANGE_EVENT_TYPE_LABEL[changeEvent.type]}
          {rfq.dueDate ? ` · quotes due ${formatDate(rfq.dueDate)}` : ''}
          {changeEvent.currency ? ` · ${changeEvent.currency}` : ''}{' '}
          <Badge variant='outline'>{rfq.status}</Badge>
        </p>
        {changeEvent.description && (
          <p className='text-sm whitespace-pre-wrap'>
            {changeEvent.description}
          </p>
        )}
        {rfq.instructions && (
          <p className='rounded-md border p-3 text-sm whitespace-pre-wrap'>
            {rfq.instructions}
          </p>
        )}
      </header>
      <QuoteForm key={rfq.status} token={token} view={view} />
    </div>
  )
}
