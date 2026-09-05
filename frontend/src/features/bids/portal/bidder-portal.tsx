import { useRef, useState } from 'react'
import { Download, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { BidLine, BidRecord } from '../hooks/use-bids'
import {
  portalDocumentHref,
  usePortalAsk,
  usePortalBidAction,
  usePortalSaveBid,
  usePortalUpload,
  usePortalView,
  type PortalView,
} from './use-bid-portal'

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : '—'
const formatMoney = (value: number, currency: string) =>
  `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`

type LineDraft = { rate: string; included: boolean; note: string }

const draftFrom = (lines: BidLine[], bid: BidRecord | null) =>
  Object.fromEntries(
    lines.map((line) => {
      const priced = bid?.lines.find((item) => item.packageLineId === line.id)
      return [
        line.id,
        {
          rate:
            priced?.rate === null || priced?.rate === undefined
              ? ''
              : String(priced.rate),
          included: priced ? priced.included : true,
          note: priced?.note ?? '',
        },
      ]
    })
  ) as Record<string, LineDraft>

function BidForm({ token, view }: { token: string; view: PortalView }) {
  const { package: pkg, bid } = view
  const save = usePortalSaveBid(token)
  const act = usePortalBidAction(token)
  const upload = usePortalUpload(token)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [lines, setLines] = useState<Record<string, LineDraft>>(() =>
    draftFrom(pkg.lines, bid)
  )
  const [meta, setMeta] = useState({
    inclusions: bid?.inclusions ?? '',
    exclusions: bid?.exclusions ?? '',
    notes: bid?.notes ?? '',
    validityDays: bid?.validityDays?.toString() ?? '',
    leadTimeDays: bid?.leadTimeDays?.toString() ?? '',
    submittedBy: bid?.submittedBy ?? view.invitation.contactName ?? '',
  })
  const submitted = bid?.status === 'submitted'
  const editable = pkg.acceptingBids && !submitted
  const total = pkg.lines.reduce((sum, line) => {
    const draft = lines[line.id]
    if (!draft?.included || draft.rate === '') return sum
    return sum + line.qty * Number(draft.rate.replace(/,/g, ''))
  }, 0)
  const missing = pkg.lines.filter(
    (line) => lines[line.id]?.included && lines[line.id]?.rate === ''
  )

  const payload = () => ({
    lines: pkg.lines.map((line) => ({
      packageLineId: line.id,
      rate: lines[line.id]?.rate === '' ? null : lines[line.id]?.rate,
      included: lines[line.id]?.included ?? true,
      note: lines[line.id]?.note || null,
    })),
    inclusions: meta.inclusions || null,
    exclusions: meta.exclusions || null,
    notes: meta.notes || null,
    validityDays: meta.validityDays === '' ? null : Number(meta.validityDays),
    leadTimeDays: meta.leadTimeDays === '' ? null : Number(meta.leadTimeDays),
  })

  const saveDraft = async () => {
    try {
      await save.mutateAsync(payload())
      toast.success('Draft saved')
      return true
    } catch (error) {
      toast.error(getServerErrorMessage(error))
      return false
    }
  }

  return (
    <section className='space-y-3' data-testid='uat-portal-bid'>
      <div className='flex flex-wrap items-center gap-2'>
        <h2 className='text-lg font-semibold'>Your bid</h2>
        {bid && (
          <Badge variant={submitted ? 'default' : 'outline'}>
            {submitted
              ? `Submitted ${formatDate(bid.submittedAt)}`
              : bid.status === 'withdrawn'
                ? 'Withdrawn — edit and resubmit'
                : 'Draft'}
          </Badge>
        )}
        {bid?.version && bid.version > 1 && (
          <span className='text-xs text-muted-foreground'>
            revision {bid.version}
          </span>
        )}
      </div>
      {!pkg.acceptingBids && (
        <p className='rounded-md border p-3 text-sm text-muted-foreground'>
          {pkg.status === 'awarded'
            ? pkg.awarded === 'you'
              ? 'This package was awarded to you.'
              : 'This package has been awarded.'
            : 'This package is no longer accepting bids.'}
        </p>
      )}
      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/40 text-xs'>
            <tr>
              <th className='px-2 py-1 text-left'>#</th>
              <th className='px-2 py-1 text-left'>Description</th>
              <th className='px-2 py-1 text-left'>Unit</th>
              <th className='px-2 py-1 text-right'>Qty</th>
              <th className='px-2 py-1 text-right'>Your rate</th>
              <th className='px-2 py-1 text-right'>Amount</th>
              <th className='px-2 py-1 text-center'>Included</th>
              <th className='px-2 py-1 text-left'>Note</th>
            </tr>
          </thead>
          <tbody>
            {pkg.lines.map((line) => {
              const draft = lines[line.id] ?? {
                rate: '',
                included: true,
                note: '',
              }
              const amount =
                draft.included && draft.rate !== ''
                  ? line.qty * Number(draft.rate.replace(/,/g, ''))
                  : null
              return (
                <tr
                  key={line.id}
                  className={cn(
                    'border-t',
                    !draft.included && 'text-muted-foreground'
                  )}
                  data-testid='uat-portal-line'
                >
                  <td className='px-2 py-1'>{line.lineNumber}</td>
                  <td className='px-2 py-1'>
                    {line.code ? `${line.code} ` : ''}
                    {line.description}
                    {line.section ? (
                      <span className='block text-xs text-muted-foreground'>
                        {line.section}
                      </span>
                    ) : null}
                  </td>
                  <td className='px-2 py-1'>{line.unit ?? ''}</td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {line.qty.toLocaleString()}
                  </td>
                  <td className='px-2 py-1 text-right'>
                    <Input
                      type='number'
                      inputMode='decimal'
                      step='0.01'
                      min={0}
                      className='ml-auto h-8 w-28 text-right'
                      value={draft.rate}
                      disabled={!editable || !draft.included}
                      aria-label={`Rate for line ${line.lineNumber}`}
                      onChange={(event) =>
                        setLines({
                          ...lines,
                          [line.id]: { ...draft, rate: event.target.value },
                        })
                      }
                    />
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {amount === null
                      ? '—'
                      : amount.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                  </td>
                  <td className='px-2 py-1 text-center'>
                    <Checkbox
                      checked={draft.included}
                      disabled={!editable}
                      aria-label={`Include line ${line.lineNumber}`}
                      onCheckedChange={(state) =>
                        setLines({
                          ...lines,
                          [line.id]: { ...draft, included: state === true },
                        })
                      }
                    />
                  </td>
                  <td className='px-2 py-1'>
                    <Input
                      className='h-8'
                      placeholder={draft.included ? '' : 'Why excluded'}
                      value={draft.note}
                      disabled={!editable}
                      onChange={(event) =>
                        setLines({
                          ...lines,
                          [line.id]: { ...draft, note: event.target.value },
                        })
                      }
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className='border-t font-medium'>
              <td colSpan={5} className='px-2 py-1 text-right'>
                Total
              </td>
              <td
                className='px-2 py-1 text-right tabular-nums'
                data-testid='uat-portal-total'
              >
                {formatMoney(total, pkg.currency)}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-1'>
          <Label>Inclusions</Label>
          <Textarea
            rows={2}
            value={meta.inclusions}
            disabled={!editable}
            onChange={(event) =>
              setMeta({ ...meta, inclusions: event.target.value })
            }
          />
        </div>
        <div className='space-y-1'>
          <Label>Exclusions</Label>
          <Textarea
            rows={2}
            value={meta.exclusions}
            disabled={!editable}
            onChange={(event) =>
              setMeta({ ...meta, exclusions: event.target.value })
            }
          />
        </div>
        <div className='space-y-1 sm:col-span-2'>
          <Label>Notes to the project team</Label>
          <Textarea
            rows={2}
            value={meta.notes}
            disabled={!editable}
            onChange={(event) =>
              setMeta({ ...meta, notes: event.target.value })
            }
          />
        </div>
        <div className='space-y-1'>
          <Label>Bid valid for (days)</Label>
          <Input
            type='number'
            min={0}
            value={meta.validityDays}
            disabled={!editable}
            onChange={(event) =>
              setMeta({ ...meta, validityDays: event.target.value })
            }
          />
        </div>
        <div className='space-y-1'>
          <Label>Lead time to start (days)</Label>
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
      </div>
      <div className='flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm'>
        <span>Priced form (PDF or spreadsheet), optional:</span>
        {bid?.documentId ? <Badge variant='outline'>uploaded</Badge> : null}
        <input
          ref={fileRef}
          type='file'
          className='hidden'
          accept='.pdf,.xlsx,.xls,.docx,.doc,.png,.jpg,.jpeg'
          onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            try {
              await upload.mutateAsync(file)
              toast.success('File uploaded')
            } catch (error) {
              toast.error(getServerErrorMessage(error))
            }
          }}
        />
        <Button
          size='sm'
          variant='outline'
          disabled={!editable || upload.isPending}
          onClick={() => fileRef.current?.click()}
        >
          {upload.isPending ? (
            <Loader2 className='mr-1 h-4 w-4 animate-spin' />
          ) : (
            <Upload className='mr-1 h-4 w-4' />
          )}
          Upload
        </Button>
      </div>
      {editable && (
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            variant='outline'
            disabled={save.isPending}
            data-testid='uat-portal-save'
            onClick={saveDraft}
          >
            {save.isPending && (
              <Loader2 className='mr-1 h-4 w-4 animate-spin' />
            )}
            Save draft
          </Button>
          <Input
            className='w-56'
            placeholder='Your name (signs the bid)'
            value={meta.submittedBy}
            onChange={(event) =>
              setMeta({ ...meta, submittedBy: event.target.value })
            }
          />
          <Button
            disabled={save.isPending || act.isPending}
            data-testid='uat-portal-submit'
            onClick={async () => {
              if (missing.length && !bid?.documentId) {
                toast.error(
                  `Price or exclude every line (${missing
                    .slice(0, 6)
                    .map((line) => line.lineNumber)
                    .join(', ')}${missing.length > 6 ? '…' : ''})`
                )
                return
              }
              if (!(await saveDraft())) return
              try {
                await act.mutateAsync({
                  action: 'bid/submit',
                  body: { submittedBy: meta.submittedBy || null },
                })
                toast.success('Bid submitted — thank you')
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {act.isPending && <Loader2 className='mr-1 h-4 w-4 animate-spin' />}
            Submit bid
          </Button>
          {view.invitation.status !== 'declined' && !bid && (
            <Button
              variant='ghost'
              className='ml-auto'
              disabled={act.isPending}
              onClick={async () => {
                const reason = window.prompt(
                  'Decline to bid? Reason (optional):'
                )
                if (reason === null) return
                try {
                  await act.mutateAsync({
                    action: 'decline',
                    body: { reason: reason || null },
                  })
                  toast.success('Declined')
                } catch (error) {
                  toast.error(getServerErrorMessage(error))
                }
              }}
            >
              Decline to bid
            </Button>
          )}
        </div>
      )}
      {submitted && pkg.acceptingBids && (
        <Button
          variant='outline'
          disabled={act.isPending}
          data-testid='uat-portal-withdraw'
          onClick={async () => {
            if (
              !window.confirm(
                'Withdraw your bid? You can edit and resubmit it until the due date.'
              )
            )
              return
            try {
              await act.mutateAsync({ action: 'bid/withdraw' })
              toast.success('Bid withdrawn')
            } catch (error) {
              toast.error(getServerErrorMessage(error))
            }
          }}
        >
          Withdraw to edit
        </Button>
      )}
    </section>
  )
}

function Questions({ token, view }: { token: string; view: PortalView }) {
  const ask = usePortalAsk(token)
  const [question, setQuestion] = useState('')
  return (
    <section className='space-y-2' data-testid='uat-portal-questions'>
      <h2 className='text-lg font-semibold'>Questions</h2>
      {view.package.questions.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No questions yet.</p>
      ) : (
        <ul className='space-y-2 text-sm'>
          {view.package.questions.map((item) => (
            <li key={item.id} className='rounded-md border p-2'>
              <p>
                <span className='text-xs text-muted-foreground'>
                  {item.mine ? 'You asked' : 'Shared question'} ·{' '}
                  {formatDate(item.askedAt)}
                </span>
              </p>
              <p>{item.question}</p>
              {item.answer ? (
                <p className='mt-1 text-muted-foreground'>
                  <span className='font-medium text-foreground'>Answer:</span>{' '}
                  {item.answer}
                </p>
              ) : (
                <p className='text-xs text-muted-foreground'>Awaiting answer</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {view.package.questionsOpen ? (
        <div className='space-y-1'>
          <Textarea
            rows={2}
            placeholder='Ask the project team'
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <Button
            size='sm'
            variant='outline'
            disabled={!question.trim() || ask.isPending}
            data-testid='uat-portal-ask'
            onClick={async () => {
              try {
                await ask.mutateAsync({
                  question: question.trim(),
                  askedBy: view.invitation.contactName,
                })
                setQuestion('')
                toast.success('Question sent')
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            Send question
          </Button>
        </div>
      ) : (
        <p className='text-xs text-muted-foreground'>
          The question period is closed.
        </p>
      )}
    </section>
  )
}

/** Public page `/bid/$token`: one invitation's view of a bid package. */
export function BidderPortal({ token }: { token: string }) {
  const { data: view, isLoading, error } = usePortalView(token)
  if (isLoading) {
    return (
      <div className='flex min-h-screen items-center justify-center text-sm text-muted-foreground'>
        <Loader2 className='mr-2 h-4 w-4 animate-spin' /> Opening your bid
        portal…
      </div>
    )
  }
  if (error || !view) {
    return (
      <div className='mx-auto max-w-lg space-y-2 px-4 py-16 text-center'>
        <h1 className='text-xl font-semibold'>
          This bid link cannot be opened
        </h1>
        <p className='text-sm text-muted-foreground'>
          {getServerErrorMessage(error)}
        </p>
        <p className='text-sm text-muted-foreground'>
          Links expire and are replaced by the latest email you received; ask
          the project team for a new invitation.
        </p>
      </div>
    )
  }
  const { package: pkg, invitation } = view
  return (
    <div
      className='mx-auto max-w-5xl space-y-6 px-4 py-8'
      data-testid='uat-portal'
    >
      <header className='space-y-1'>
        <p className='text-xs tracking-wide text-muted-foreground uppercase'>
          Invitation to bid · {invitation.companyName}
        </p>
        <h1 className='text-2xl font-semibold'>
          {pkg.ref} · {pkg.title}
        </h1>
        <p className='text-sm text-muted-foreground'>
          {pkg.dueAt ? `Bids due ${formatDate(pkg.dueAt)}` : 'No due date set'}
          {pkg.questionsDueAt
            ? ` · questions until ${formatDate(pkg.questionsDueAt)}`
            : ''}
          {' · '}currency {pkg.currency}
        </p>
        {pkg.description && <p className='text-sm'>{pkg.description}</p>}
        {pkg.instructions && (
          <p className='rounded-md border p-3 text-sm whitespace-pre-wrap'>
            {pkg.instructions}
          </p>
        )}
      </header>
      <section className='space-y-2' data-testid='uat-portal-documents'>
        <h2 className='text-lg font-semibold'>Documents</h2>
        {pkg.documents.length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            No documents attached.
          </p>
        ) : (
          <ul className='divide-y rounded-md border text-sm'>
            {pkg.documents.map((document) => (
              <li
                key={document.id}
                className='flex items-center gap-2 px-3 py-2'
              >
                <span className='flex-1 truncate'>
                  {document.fileName}
                  {document.caption ? (
                    <span className='text-muted-foreground'>
                      {' '}
                      · {document.caption}
                    </span>
                  ) : null}
                </span>
                <span className='text-xs text-muted-foreground'>
                  {(document.sizeBytes / 1024).toFixed(0)} KB
                </span>
                <Button asChild size='sm' variant='outline' className='h-7'>
                  <a
                    href={portalDocumentHref(document.downloadUrl)}
                    target='_blank'
                    rel='noreferrer'
                  >
                    <Download className='mr-1 h-3 w-3' /> Download
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {pkg.addenda.length > 0 && (
        <section className='space-y-2' data-testid='uat-portal-addenda'>
          <h2 className='text-lg font-semibold'>Addenda</h2>
          {pkg.addenda.map((item) => (
            <div key={item.id} className='rounded-md border p-2 text-sm'>
              <p className='font-medium'>
                Addendum {item.number}: {item.title}
              </p>
              {item.body && (
                <p className='whitespace-pre-wrap text-muted-foreground'>
                  {item.body}
                </p>
              )}
              <p className='text-xs text-muted-foreground'>
                issued {formatDate(item.issuedAt)}
              </p>
            </div>
          ))}
        </section>
      )}
      <Questions token={token} view={view} />
      <BidForm
        key={`${view.bid?.id ?? 'new'}-${view.bid?.status ?? ''}-${view.bid?.updatedAt ?? ''}`}
        token={token}
        view={view}
      />
      <footer className='text-xs text-muted-foreground'>
        This link is personal to {invitation.companyName} and expires{' '}
        {formatDate(invitation.expiresAt)}. Other bidders never see your prices
        or questions.
      </footer>
    </div>
  )
}
