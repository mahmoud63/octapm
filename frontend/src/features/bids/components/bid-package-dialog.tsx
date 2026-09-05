import { useState } from 'react'
import { Loader2, Plus, Send } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { AttachmentPanel } from '@/features/attachments/components/attachment-panel'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import { useVendors } from '@/features/company/hooks/use-company'
import {
  INVITATION_STATUS_LABEL,
  PACKAGE_STATUS_LABEL,
  formatBidDate,
  formatBidMoney,
  useAnswerBidQuestion,
  useBidBoqSections,
  useBidPackage,
  useBidPackageAction,
  useAddBidLinesFromBoq,
  useCancelBidPackage,
  useDeleteBidLine,
  useInviteBidders,
  useIssueBidAddendum,
  useRemoveBidInvitation,
  useResendBidInvitation,
  useSaveBidLine,
  useUpdateBidPackage,
  type BidPackage,
} from '../hooks/use-bids'
import { BidLevelingGrid } from './bid-leveling'

const NONE = '__none__'

function BriefTab({ projectId, pkg }: { projectId: string; pkg: BidPackage }) {
  const canUpdate = useCanPerform('bid', 'update')
  const update = useUpdateBidPackage(projectId)
  const [draft, setDraft] = useState({
    title: pkg.title,
    description: pkg.description ?? '',
    instructions: pkg.instructions ?? '',
    dueAt: pkg.dueAt ? pkg.dueAt.slice(0, 16) : '',
    questionsDueAt: pkg.questionsDueAt ? pkg.questionsDueAt.slice(0, 16) : '',
  })
  const locked = ['awarded', 'cancelled'].includes(pkg.status) || !canUpdate
  return (
    <div className='space-y-3'>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-1 sm:col-span-2'>
          <Label>Title</Label>
          <Input
            value={draft.title}
            disabled={locked}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
        </div>
        <div className='space-y-1'>
          <Label>Bids due</Label>
          <Input
            type='datetime-local'
            value={draft.dueAt}
            disabled={locked}
            onChange={(event) =>
              setDraft({ ...draft, dueAt: event.target.value })
            }
          />
        </div>
        <div className='space-y-1'>
          <Label>Questions until</Label>
          <Input
            type='datetime-local'
            value={draft.questionsDueAt}
            disabled={locked}
            onChange={(event) =>
              setDraft({ ...draft, questionsDueAt: event.target.value })
            }
          />
        </div>
        <div className='space-y-1 sm:col-span-2'>
          <Label>Scope summary (shown to bidders)</Label>
          <Textarea
            rows={3}
            value={draft.description}
            disabled={locked}
            onChange={(event) =>
              setDraft({ ...draft, description: event.target.value })
            }
          />
        </div>
        <div className='space-y-1 sm:col-span-2'>
          <Label>Instructions to bidders</Label>
          <Textarea
            rows={4}
            value={draft.instructions}
            disabled={locked}
            onChange={(event) =>
              setDraft({ ...draft, instructions: event.target.value })
            }
          />
        </div>
      </div>
      {!locked && (
        <div className='flex justify-end'>
          <Button
            size='sm'
            disabled={update.isPending}
            data-testid='uat-bid-save-brief'
            onClick={async () => {
              try {
                await update.mutateAsync({
                  packageId: pkg.id,
                  payload: {
                    title: draft.title.trim(),
                    description: draft.description.trim() || null,
                    instructions: draft.instructions.trim() || null,
                    dueAt: draft.dueAt
                      ? new Date(draft.dueAt).toISOString()
                      : null,
                    questionsDueAt: draft.questionsDueAt
                      ? new Date(draft.questionsDueAt).toISOString()
                      : null,
                  },
                })
                toast.success('Package saved')
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            Save brief
          </Button>
        </div>
      )}
      <div className='space-y-2'>
        <h4 className='text-sm font-semibold'>Documents for bidders</h4>
        <p className='text-xs text-muted-foreground'>
          Everything attached here is downloadable from every bidder's portal.
        </p>
        <AttachmentPanel
          projectId={projectId}
          recordType='bid_package'
          recordId={pkg.id}
        />
      </div>
    </div>
  )
}

function LinesTab({ projectId, pkg }: { projectId: string; pkg: BidPackage }) {
  const canUpdate = useCanPerform('bid', 'update')
  const { data: sections = [] } = useBidBoqSections(
    projectId,
    pkg.status === 'draft'
  )
  const addFromBoq = useAddBidLinesFromBoq(projectId)
  const saveLine = useSaveBidLine(projectId)
  const removeLine = useDeleteBidLine(projectId)
  const [section, setSection] = useState('')
  const [manual, setManual] = useState({
    description: '',
    unit: '',
    qty: '1',
    estimateRate: '',
  })
  const editable = canUpdate && pkg.status === 'draft'
  const lines = pkg.lines ?? []
  const estimate = lines.reduce(
    (sum, line) => sum + (line.estimateAmount ?? 0),
    0
  )
  return (
    <div className='space-y-3'>
      {editable && (
        <div className='flex flex-wrap items-end gap-2 rounded-md border p-2'>
          <div className='space-y-1'>
            <Label className='text-xs'>Add a BOQ section</Label>
            <Select
              value={section || NONE}
              onValueChange={(value) => setSection(value === NONE ? '' : value)}
            >
              <SelectTrigger className='w-64' aria-label='BOQ section'>
                <SelectValue placeholder='Section' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Choose…</SelectItem>
                {sections.map((item) => (
                  <SelectItem key={item.key} value={item.key || '(none)'}>
                    {item.section} · {item.items}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size='sm'
            variant='outline'
            disabled={!section || addFromBoq.isPending}
            data-testid='uat-bid-add-section'
            onClick={async () => {
              try {
                await addFromBoq.mutateAsync({
                  packageId: pkg.id,
                  sections: [section === '(none)' ? '' : section],
                })
                setSection('')
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            <Plus className='mr-1 h-3 w-3' /> Add lines
          </Button>
          <div className='ml-auto flex flex-wrap items-end gap-1'>
            <Input
              className='w-56'
              placeholder='Manual line description'
              value={manual.description}
              onChange={(event) =>
                setManual({ ...manual, description: event.target.value })
              }
            />
            <Input
              className='w-20'
              placeholder='Unit'
              value={manual.unit}
              onChange={(event) =>
                setManual({ ...manual, unit: event.target.value })
              }
            />
            <Input
              className='w-20'
              type='number'
              placeholder='Qty'
              value={manual.qty}
              onChange={(event) =>
                setManual({ ...manual, qty: event.target.value })
              }
            />
            <Input
              className='w-28'
              type='number'
              placeholder='Est. rate'
              value={manual.estimateRate}
              onChange={(event) =>
                setManual({ ...manual, estimateRate: event.target.value })
              }
            />
            <Button
              size='sm'
              variant='outline'
              disabled={!manual.description.trim() || saveLine.isPending}
              onClick={async () => {
                try {
                  await saveLine.mutateAsync({
                    packageId: pkg.id,
                    payload: {
                      description: manual.description.trim(),
                      unit: manual.unit || null,
                      qty: Number(manual.qty) || 1,
                      estimateRate:
                        manual.estimateRate === ''
                          ? null
                          : Number(manual.estimateRate),
                    },
                  })
                  setManual({
                    description: '',
                    unit: '',
                    qty: '1',
                    estimateRate: '',
                  })
                } catch (error) {
                  toast.error(getServerErrorMessage(error))
                }
              }}
            >
              Add
            </Button>
          </div>
        </div>
      )}
      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm' data-testid='uat-bid-lines'>
          <thead className='bg-muted/40 text-xs'>
            <tr>
              <th className='px-2 py-1 text-left'>#</th>
              <th className='px-2 py-1 text-left'>Section</th>
              <th className='px-2 py-1 text-left'>Code</th>
              <th className='px-2 py-1 text-left'>Description</th>
              <th className='px-2 py-1 text-left'>Unit</th>
              <th className='px-2 py-1 text-right'>Qty</th>
              <th className='px-2 py-1 text-right'>Est. rate</th>
              <th className='px-2 py-1 text-right'>Est. amount</th>
              {editable && <th className='px-2 py-1' />}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className='px-2 py-4 text-center text-muted-foreground'
                >
                  No lines yet.
                </td>
              </tr>
            )}
            {lines.map((line) => (
              <tr key={line.id} className='border-t'>
                <td className='px-2 py-1'>{line.lineNumber}</td>
                <td className='px-2 py-1 text-muted-foreground'>
                  {line.section ?? ''}
                </td>
                <td className='px-2 py-1'>{line.code ?? ''}</td>
                <td className='px-2 py-1'>{line.description}</td>
                <td className='px-2 py-1'>{line.unit ?? ''}</td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {line.qty.toLocaleString()}
                </td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {line.estimateRate?.toLocaleString() ?? '—'}
                </td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {line.estimateAmount?.toLocaleString() ?? '—'}
                </td>
                {editable && (
                  <td className='px-2 py-1 text-right'>
                    <Button
                      size='sm'
                      variant='ghost'
                      className='h-6 px-2'
                      disabled={removeLine.isPending}
                      onClick={() =>
                        removeLine
                          .mutateAsync({ packageId: pkg.id, lineId: line.id })
                          .catch((error) =>
                            toast.error(getServerErrorMessage(error))
                          )
                      }
                    >
                      Remove
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className='border-t font-medium'>
                <td colSpan={7} className='px-2 py-1 text-right'>
                  Internal estimate
                </td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {formatBidMoney(estimate, pkg.currency)}
                </td>
                {editable && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

function BiddersTab({
  projectId,
  pkg,
}: {
  projectId: string
  pkg: BidPackage
}) {
  const canUpdate = useCanPerform('bid', 'update')
  const { data: vendors } = useVendors({}, { enabled: canUpdate })
  const invite = useInviteBidders(projectId)
  const resend = useResendBidInvitation(projectId)
  const remove = useRemoveBidInvitation(projectId)
  const [vendorId, setVendorId] = useState('')
  const [adHoc, setAdHoc] = useState({
    companyName: '',
    contactName: '',
    contactEmail: '',
  })
  const [links, setLinks] = useState<Record<string, string>>({})
  const locked = ['awarded', 'cancelled'].includes(pkg.status) || !canUpdate
  const add = async (invitation: {
    vendorCompanyId?: string
    companyName?: string
    contactName?: string
    contactEmail?: string
  }) => {
    try {
      const created = await invite.mutateAsync({
        packageId: pkg.id,
        invitations: [invitation],
      })
      const withLink = created.find((item) => item.portalUrl)
      if (withLink?.portalUrl)
        setLinks((prev) => ({
          ...prev,
          [withLink.id]: withLink.portalUrl as string,
        }))
      toast.success(
        pkg.status === 'open'
          ? 'Invitation emailed'
          : 'Bidder added — they are emailed when you publish'
      )
      setVendorId('')
      setAdHoc({ companyName: '', contactName: '', contactEmail: '' })
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  return (
    <div className='space-y-3'>
      {!locked && (
        <div className='space-y-2 rounded-md border p-2'>
          <div className='flex flex-wrap items-end gap-2'>
            <div className='space-y-1'>
              <Label className='text-xs'>From the vendor directory</Label>
              <Select
                value={vendorId || NONE}
                onValueChange={(value) =>
                  setVendorId(value === NONE ? '' : value)
                }
              >
                <SelectTrigger
                  className='w-64'
                  aria-label='Vendor'
                  data-testid='uat-bid-vendor'
                >
                  <SelectValue placeholder='Vendor' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Choose…</SelectItem>
                  {(vendors?.items ?? []).map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.name}
                      {vendor.email ? ` · ${vendor.email}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size='sm'
              variant='outline'
              disabled={!vendorId || invite.isPending}
              data-testid='uat-bid-invite-vendor'
              onClick={() => add({ vendorCompanyId: vendorId })}
            >
              <Plus className='mr-1 h-3 w-3' /> Invite
            </Button>
          </div>
          <div className='flex flex-wrap items-end gap-2'>
            <Input
              className='w-48'
              placeholder='Company'
              value={adHoc.companyName}
              onChange={(event) =>
                setAdHoc({ ...adHoc, companyName: event.target.value })
              }
            />
            <Input
              className='w-40'
              placeholder='Contact name'
              value={adHoc.contactName}
              onChange={(event) =>
                setAdHoc({ ...adHoc, contactName: event.target.value })
              }
            />
            <Input
              className='w-56'
              type='email'
              placeholder='Email'
              data-testid='uat-bid-invite-email'
              value={adHoc.contactEmail}
              onChange={(event) =>
                setAdHoc({ ...adHoc, contactEmail: event.target.value })
              }
            />
            <Button
              size='sm'
              variant='outline'
              disabled={
                !adHoc.companyName.trim() ||
                !adHoc.contactEmail.trim() ||
                invite.isPending
              }
              onClick={() =>
                add({
                  companyName: adHoc.companyName.trim(),
                  contactName: adHoc.contactName.trim() || undefined,
                  contactEmail: adHoc.contactEmail.trim(),
                })
              }
            >
              <Plus className='mr-1 h-3 w-3' /> Invite by email
            </Button>
          </div>
        </div>
      )}
      {(pkg.invitations ?? []).length === 0 ? (
        <p className='text-sm text-muted-foreground'>No bidders yet.</p>
      ) : (
        <ul
          className='divide-y rounded-md border text-sm'
          data-testid='uat-bid-invitations'
        >
          {(pkg.invitations ?? []).map((invitation) => (
            <li
              key={invitation.id}
              className='flex flex-wrap items-center gap-2 px-3 py-2'
            >
              <span className='font-medium'>{invitation.companyName}</span>
              <span className='text-xs text-muted-foreground'>
                {invitation.contactName ? `${invitation.contactName} · ` : ''}
                {invitation.contactEmail}
              </span>
              <Badge
                variant={
                  invitation.status === 'submitted'
                    ? 'default'
                    : invitation.status === 'declined'
                      ? 'destructive'
                      : 'outline'
                }
              >
                {INVITATION_STATUS_LABEL[invitation.status]}
              </Badge>
              {invitation.bidTotal !== null &&
                invitation.bidStatus &&
                invitation.bidStatus !== 'draft' && (
                  <span className='text-xs'>
                    {formatBidMoney(invitation.bidTotal, pkg.currency)}
                  </span>
                )}
              <span className='text-xs text-muted-foreground'>
                {invitation.viewedAt
                  ? `viewed ${formatBidDate(invitation.viewedAt)}`
                  : 'not viewed'}
                {invitation.remindersSent
                  ? ` · ${invitation.remindersSent} reminder${invitation.remindersSent === 1 ? '' : 's'}`
                  : ''}
              </span>
              {links[invitation.id] && (
                <code
                  className='w-full truncate rounded bg-muted px-1 text-[11px]'
                  title={links[invitation.id]}
                >
                  {links[invitation.id]}
                </code>
              )}
              {!locked && (
                <div className='ml-auto flex gap-1'>
                  {pkg.status === 'open' && (
                    <Button
                      size='sm'
                      variant='outline'
                      className='h-7'
                      disabled={resend.isPending}
                      onClick={async () => {
                        try {
                          const updated = await resend.mutateAsync({
                            packageId: pkg.id,
                            invitationId: invitation.id,
                          })
                          if (updated.portalUrl)
                            setLinks((prev) => ({
                              ...prev,
                              [invitation.id]: updated.portalUrl as string,
                            }))
                          toast.success('Reminder sent with a fresh link')
                        } catch (error) {
                          toast.error(getServerErrorMessage(error))
                        }
                      }}
                    >
                      <Send className='mr-1 h-3 w-3' /> Resend
                    </Button>
                  )}
                  {invitation.status !== 'submitted' && (
                    <Button
                      size='sm'
                      variant='ghost'
                      className='h-7'
                      disabled={remove.isPending}
                      onClick={() =>
                        remove
                          .mutateAsync({
                            packageId: pkg.id,
                            invitationId: invitation.id,
                          })
                          .catch((error) =>
                            toast.error(getServerErrorMessage(error))
                          )
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function QuestionsTab({
  projectId,
  pkg,
}: {
  projectId: string
  pkg: BidPackage
}) {
  const canAnswer = useCanPerform('bid', 'update', 'bid.answer')
  const answer = useAnswerBidQuestion(projectId)
  const issue = useIssueBidAddendum(projectId)
  const [drafts, setDrafts] = useState<
    Record<string, { answer: string; shared: boolean }>
  >({})
  const [addendum, setAddendum] = useState({ title: '', body: '' })
  const canUpdate = useCanPerform('bid', 'update')
  return (
    <div className='space-y-4'>
      <section className='space-y-2'>
        <h4 className='text-sm font-semibold'>Questions from bidders</h4>
        {(pkg.questions ?? []).length === 0 ? (
          <p className='text-sm text-muted-foreground'>No questions yet.</p>
        ) : (
          <ul className='space-y-2' data-testid='uat-bid-questions'>
            {(pkg.questions ?? []).map((question) => {
              const draft = drafts[question.id] ?? {
                answer: question.answer ?? '',
                shared: question.shared,
              }
              return (
                <li
                  key={question.id}
                  className='space-y-1 rounded-md border p-2 text-sm'
                >
                  <p>
                    <span className='font-medium'>
                      {question.companyName ?? 'Bidder'}
                    </span>
                    <span className='text-xs text-muted-foreground'>
                      {' '}
                      · {formatBidDate(question.askedAt)}
                    </span>
                  </p>
                  <p>{question.question}</p>
                  {question.status === 'answered' && (
                    <p className='text-muted-foreground'>
                      <span className='font-medium text-foreground'>
                        Answer:
                      </span>{' '}
                      {question.answer}
                      {question.shared && (
                        <Badge variant='outline' className='ml-2'>
                          shared with all bidders
                        </Badge>
                      )}
                    </p>
                  )}
                  {canAnswer && ['open', 'closed'].includes(pkg.status) && (
                    <div className='space-y-1'>
                      <Textarea
                        rows={2}
                        placeholder={
                          question.status === 'answered'
                            ? 'Revise the answer'
                            : 'Answer'
                        }
                        value={draft.answer}
                        onChange={(event) =>
                          setDrafts({
                            ...drafts,
                            [question.id]: {
                              ...draft,
                              answer: event.target.value,
                            },
                          })
                        }
                      />
                      <div className='flex items-center gap-3'>
                        <label className='flex items-center gap-1.5 text-xs'>
                          <Checkbox
                            checked={draft.shared}
                            onCheckedChange={(state) =>
                              setDrafts({
                                ...drafts,
                                [question.id]: {
                                  ...draft,
                                  shared: state === true,
                                },
                              })
                            }
                          />
                          Share with every bidder (asker stays anonymous)
                        </label>
                        <Button
                          size='sm'
                          className='ml-auto h-7'
                          disabled={!draft.answer.trim() || answer.isPending}
                          data-testid='uat-bid-answer'
                          onClick={async () => {
                            try {
                              await answer.mutateAsync({
                                packageId: pkg.id,
                                questionId: question.id,
                                answer: draft.answer.trim(),
                                shared: draft.shared,
                              })
                              toast.success(
                                draft.shared
                                  ? 'Answer sent to every bidder'
                                  : 'Answer sent to the bidder'
                              )
                            } catch (error) {
                              toast.error(getServerErrorMessage(error))
                            }
                          }}
                        >
                          Send answer
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <section className='space-y-2'>
        <h4 className='text-sm font-semibold'>Addenda</h4>
        {(pkg.addenda ?? []).map((item) => (
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
              issued {formatBidDate(item.issuedAt)}
            </p>
          </div>
        ))}
        {canUpdate && ['draft', 'open'].includes(pkg.status) && (
          <div className='space-y-1 rounded-md border p-2'>
            <Input
              placeholder='Addendum title'
              data-testid='uat-bid-addendum-title'
              value={addendum.title}
              onChange={(event) =>
                setAddendum({ ...addendum, title: event.target.value })
              }
            />
            <Textarea
              rows={3}
              placeholder='What changed (sent to every bidder on open packages)'
              value={addendum.body}
              onChange={(event) =>
                setAddendum({ ...addendum, body: event.target.value })
              }
            />
            <div className='flex justify-end'>
              <Button
                size='sm'
                variant='outline'
                disabled={!addendum.title.trim() || issue.isPending}
                onClick={async () => {
                  try {
                    await issue.mutateAsync({
                      packageId: pkg.id,
                      title: addendum.title.trim(),
                      body: addendum.body.trim() || null,
                    })
                    setAddendum({ title: '', body: '' })
                    toast.success('Addendum issued')
                  } catch (error) {
                    toast.error(getServerErrorMessage(error))
                  }
                }}
              >
                Issue addendum
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

/** One bid package: brief & documents, lines, bidders, Q&A, bids & leveling, award. */
export function BidPackageDialog({
  projectId,
  packageId,
  onOpenChange,
}: {
  projectId: string
  packageId: string
  onOpenChange: (open: boolean) => void
}) {
  const { data: pkg, isLoading } = useBidPackage(projectId, packageId)
  const canPublish = useCanPerform('bid', 'submit', 'bid.publish')
  const canDelete = useCanPerform('bid', 'delete')
  const action = useBidPackageAction(projectId)
  const cancel = useCancelBidPackage(projectId)
  const [reopenDue, setReopenDue] = useState('')
  const run = async (
    name: 'publish' | 'close' | 'reopen',
    body?: Record<string, unknown>
  ) => {
    try {
      await action.mutateAsync({ packageId, action: name, body })
      toast.success(
        name === 'publish'
          ? 'Package published — invitations emailed'
          : name === 'close'
            ? 'Bidding closed'
            : 'Bidding reopened'
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[94vh] overflow-y-auto sm:max-w-6xl'
        data-testid='uat-bid-package'
      >
        {isLoading || !pkg ? (
          <div className='flex items-center gap-2 py-8 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Loading…
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className='flex flex-wrap items-center gap-2'>
                {pkg.ref} · {pkg.title}
                <Badge variant='outline'>
                  {PACKAGE_STATUS_LABEL[pkg.status]}
                </Badge>
                {pkg.isPastDue && pkg.status === 'open' && (
                  <Badge variant='destructive'>Past due</Badge>
                )}
              </DialogTitle>
              <DialogDescription>
                {pkg.dueAt ? `Bids due ${formatBidDate(pkg.dueAt)} · ` : ''}
                {pkg.counts.invitations} bidder
                {pkg.counts.invitations === 1 ? '' : 's'} · {pkg.counts.bids}{' '}
                bid{pkg.counts.bids === 1 ? '' : 's'} received
                {pkg.awardedCommitmentId ? ' · commitment created' : ''}
              </DialogDescription>
            </DialogHeader>
            <div className='flex flex-wrap gap-2'>
              {canPublish && pkg.status === 'draft' && (
                <Button
                  size='sm'
                  disabled={action.isPending}
                  data-testid='uat-bid-publish'
                  onClick={() => run('publish')}
                >
                  <Send className='mr-1 h-4 w-4' /> Publish & invite
                </Button>
              )}
              {canPublish && pkg.status === 'open' && (
                <Button
                  size='sm'
                  variant='outline'
                  disabled={action.isPending}
                  onClick={() => run('close')}
                >
                  Close bidding
                </Button>
              )}
              {canPublish &&
                pkg.status === 'closed' &&
                !pkg.awardedCommitmentId && (
                  <div className='flex items-end gap-1'>
                    <Input
                      type='datetime-local'
                      className='w-56'
                      aria-label='New due date'
                      value={reopenDue}
                      onChange={(event) => setReopenDue(event.target.value)}
                    />
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={!reopenDue || action.isPending}
                      onClick={() =>
                        run('reopen', {
                          dueAt: new Date(reopenDue).toISOString(),
                        })
                      }
                    >
                      Reopen
                    </Button>
                  </div>
                )}
              {canDelete && !['awarded', 'cancelled'].includes(pkg.status) && (
                <Button
                  size='sm'
                  variant='ghost'
                  className='ml-auto'
                  disabled={cancel.isPending}
                  onClick={async () => {
                    const reason = window.prompt(
                      'Cancel this package? Bidders on an open package are told. Reason (optional):'
                    )
                    if (reason === null) return
                    try {
                      await cancel.mutateAsync({
                        packageId,
                        reason: reason || undefined,
                      })
                      toast.success('Package cancelled')
                    } catch (error) {
                      toast.error(getServerErrorMessage(error))
                    }
                  }}
                >
                  Cancel package
                </Button>
              )}
            </div>
            <Tabs defaultValue={pkg.counts.bids > 0 ? 'leveling' : 'brief'}>
              <TabsList className='flex-wrap'>
                <TabsTrigger value='brief'>Brief & documents</TabsTrigger>
                <TabsTrigger value='lines'>
                  Bid form ({pkg.counts.lines})
                </TabsTrigger>
                <TabsTrigger value='bidders'>
                  Bidders ({pkg.counts.invitations})
                </TabsTrigger>
                <TabsTrigger
                  value='questions'
                  className={cn(pkg.counts.openQuestions && 'font-semibold')}
                >
                  Q&A
                  {pkg.counts.openQuestions
                    ? ` (${pkg.counts.openQuestions} open)`
                    : ''}
                </TabsTrigger>
                <TabsTrigger value='leveling'>
                  Bids & leveling ({pkg.counts.bids})
                </TabsTrigger>
                <TabsTrigger value='history'>History</TabsTrigger>
              </TabsList>
              <TabsContent value='brief'>
                <BriefTab projectId={projectId} pkg={pkg} />
              </TabsContent>
              <TabsContent value='lines'>
                <LinesTab projectId={projectId} pkg={pkg} />
              </TabsContent>
              <TabsContent value='bidders'>
                <BiddersTab projectId={projectId} pkg={pkg} />
              </TabsContent>
              <TabsContent value='questions'>
                <QuestionsTab projectId={projectId} pkg={pkg} />
              </TabsContent>
              <TabsContent value='leveling'>
                <BidLevelingGrid projectId={projectId} pkg={pkg} />
              </TabsContent>
              <TabsContent value='history'>
                <HistoryPanel
                  projectId={projectId}
                  entityType='bid_package'
                  entityId={pkg.id}
                  title={`${pkg.ref} History`}
                  limit={30}
                  showFilters={false}
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
