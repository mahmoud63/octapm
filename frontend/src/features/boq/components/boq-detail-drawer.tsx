import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  CappedNote,
  DetailSection,
  DrawerLink,
  Empty,
  FigureRow,
  RecordLink,
  Withheld,
} from '@/features/controls/components/detail-parts'
import {
  formatDate,
  formatMoney,
  formatQuantity,
} from '@/features/controls/lib/detail-format'
import { useBoqItemDetail } from '@/features/controls/hooks/use-controls-detail'
import { RecordExceptionsSection } from '@/features/controls/exceptions/record-exceptions-section'
import { RecordQuantities } from '@/features/controls/quantities/quantities-section'
import { useRecordQuantities } from '@/features/controls/quantities/use-record-quantities'
import { useProject } from '@/features/projects/hooks/use-projects'
import { FINANCIAL_TERMS } from '@/lib/financial-terms'
import type { BoqItemDetail, ControlsStructure } from '../data/schema'

/**
 * A BOQ row's whole story (PC-5): where it sits, which activities carry it,
 * how far they have got, what it is worth, what changed it, who is buying
 * it, what was certified. Every figure is the server's, with its truth; a
 * section the viewer may not read is the server's "withheld" line; a figure
 * no service proves yet says which wave brings it. A linked activity opens
 * the activity's drawer in place, and that drawer leads back here.
 */

type Props = {
  projectId: string
  itemId: string | null
  onClose: () => void
  onOpenActivity: (activityId: string) => void
  /** The record this drawer was reached from, to go back to. */
  back?: { label: string; onBack: () => void } | null
}

export function StructureRows({ structure }: { structure: ControlsStructure }) {
  const rows: Array<[string, ControlsStructure['wbs'], string | null]> = [
    ['WBS', structure.wbs, structure.wbsCode ?? null],
    ['Location', structure.location, null],
    ['Cost code', structure.costCode, null],
  ]
  return (
    <dl className='grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-sm'>
      {rows.map(([label, ref, fallback]) => (
        <div key={label} className='contents'>
          <dt className='text-muted-foreground'>{label}</dt>
          <dd data-testid={`detail-structure-${label.toLowerCase().replace(' ', '-')}`}>
            {ref ? (
              <RecordLink href={ref.href}>
                {[ref.code, ref.name].filter(Boolean).join(' · ') || ref.id}
              </RecordLink>
            ) : label === 'Cost code' && structure.costCodeNote ? (
              <span className='text-xs text-muted-foreground'>{structure.costCodeNote}</span>
            ) : (
              <span className='text-muted-foreground'>{fallback ?? 'Not filed'}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function HistoryList({
  events,
}: {
  events: Array<{ id: string } & Record<string, unknown>>
}) {
  if (!events.length) return <Empty>No history recorded yet.</Empty>
  return (
    <ul className='space-y-1 text-sm'>
      {events.map((event) => {
        const label = String(event.label ?? event.summary ?? event.action ?? 'Event')
        const at = (event.at ?? event.occurredAt ?? event.createdAt) as string | undefined
        return (
          <li key={event.id} className='flex justify-between gap-3'>
            <span className='min-w-0 truncate'>
              {typeof event.href === 'string' ? (
                <RecordLink href={event.href}>{label}</RecordLink>
              ) : (
                label
              )}
            </span>
            <span className='shrink-0 text-xs text-muted-foreground'>{formatDate(at)}</span>
          </li>
        )
      })}
    </ul>
  )
}

function BoqDetailBody({
  projectId,
  detail,
  currency,
  onOpenActivity,
}: {
  projectId: string
  detail: BoqItemDetail
  currency: string
  onOpenActivity: (activityId: string) => void
}) {
  const { sections } = detail
  const { data: quantities } = useRecordQuantities(projectId, 'boq_item', detail.id)
  const unit = sections.quantities.unit ?? ''
  const allocations = sections.mapping.allocations
  return (
    <div className='space-y-3'>
      <DetailSection title='Structure' testId='boq-detail-structure'>
        <StructureRows structure={sections.structure} />
      </DetailSection>

      <DetailSection title='Mapping and linked activities' testId='boq-detail-mapping'>
        <div className='flex flex-wrap items-center gap-2 text-sm'>
          <Badge variant='outline'>Rule: {sections.mapping.mappingRule.replace(/_/g, ' ')}</Badge>
          {sections.mapping.mappingState && (
            <Badge variant='secondary'>{sections.mapping.mappingState.replace(/_/g, ' ')}</Badge>
          )}
          <span className='text-muted-foreground'>
            {sections.mapping.allocationCount} allocation
            {sections.mapping.allocationCount === 1 ? '' : 's'}
          </span>
        </div>
        {allocations.items.length ? (
          <div className='overflow-x-auto'>
            <table className='w-full text-sm'>
              <thead className='text-left text-xs text-muted-foreground'>
                <tr>
                  <th className='py-1 pr-2 font-medium'>Activity</th>
                  <th className='py-1 pr-2 font-medium'>Dates</th>
                  <th className='py-1 pr-2 text-right font-medium'>Progress</th>
                  <th className='py-1 pr-2 text-right font-medium'>Qty</th>
                  <th className='py-1 text-right font-medium'>Status</th>
                </tr>
              </thead>
              <tbody>
                {allocations.items.map((row) => (
                  <tr key={row.allocationId} className='border-t align-top'>
                    <td className='py-1.5 pr-2'>
                      {row.activity?.schedule ? (
                        // The schedule module refuses this member: the name
                        // only, and no link to a drawer the server would refuse.
                        <span data-testid={`boq-detail-activity-${row.activity.id}`} data-withheld-module='schedule'>
                          {[row.activity.code, row.activity.name].filter(Boolean).join(' · ')}
                        </span>
                      ) : row.activity ? (
                        <>
                          <DrawerLink
                            onClick={() => onOpenActivity(row.activity!.id)}
                            testId={`boq-detail-activity-${row.activity.id}`}
                          >
                            {[row.activity.code, row.activity.name].filter(Boolean).join(' · ')}
                          </DrawerLink>
                          <div className='mt-0.5 flex flex-wrap gap-1'>
                            {row.activity.isCritical && (
                              <Badge variant='destructive' className='px-1 py-0 text-[10px]'>
                                Critical
                              </Badge>
                            )}
                            {row.activity.totalFloat != null && (
                              <span className='text-[11px] text-muted-foreground'>
                                Float {formatQuantity(row.activity.totalFloat)}d
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <span className='text-muted-foreground'>Activity no longer in the schedule</span>
                      )}
                    </td>
                    <td className='py-1.5 pr-2 text-xs text-muted-foreground'>
                      {row.activity?.schedule ? (
                        <span title={row.activity.schedule.reason} data-testid={`boq-detail-activity-schedule-withheld-${row.activity.id}`}>
                          — {row.activity.schedule.reason}
                        </span>
                      ) : row.activity ? (
                        `${formatDate(row.activity.startDate ?? null)} → ${formatDate(row.activity.endDate ?? null)}`
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className='py-1.5 pr-2 text-right tabular-nums'>
                      {row.activity?.schedule ? (
                        <span className='text-xs text-muted-foreground' title={row.activity.schedule.reason}>
                          —
                        </span>
                      ) : row.activity?.progress ? (
                        // The progress module refuses this member, as the
                        // activity drawer's Progress section does.
                        <span
                          className='text-xs text-muted-foreground'
                          title={row.activity.progress.reason}
                          data-testid={`boq-detail-activity-progress-withheld-${row.activity.id}`}
                          data-withheld-module='progress'
                        >
                          — {row.activity.progress.reason}
                        </span>
                      ) : row.activity?.pctComplete ? (
                        <span title={row.activity.pctComplete.basis}>
                          {formatQuantity(row.activity.pctComplete.value)}%
                          {row.activity.progressSource && (
                            <span className='block text-[10px] text-muted-foreground'>
                              {row.activity.progressSource}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className='text-xs text-muted-foreground'>No approved progress</span>
                      )}
                    </td>
                    <td className='py-1.5 pr-2 text-right tabular-nums' title={row.authorisedQuantity.basis}>
                      {formatQuantity(row.quantity.value)}
                      {row.authorisedQuantity.value !== row.quantity.value && (
                        <span className='block text-[10px] text-muted-foreground'>
                          authorised {formatQuantity(row.authorisedQuantity.value)}
                        </span>
                      )}
                    </td>
                    <td className='py-1.5 text-right'>
                      <Badge variant='outline' className='text-[10px]'>
                        {row.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No activity carries this row yet.</Empty>
        )}
        <CappedNote
          shown={allocations.items.length}
          total={allocations.total}
          viewAll={allocations.viewAll}
          testId='boq-detail-mapping-view-all'
        />
      </DetailSection>

      <DetailSection title='Quantities' testId='boq-detail-quantities'>
        <FigureRow label='Original quantity' figure={sections.quantities.original} suffix={unit} testId='boq-detail-qty-original' />
        <FigureRow label='Current quantity' figure={sections.quantities.current} suffix={unit} testId='boq-detail-qty-current' />
        <FigureRow label='Approved variation' figure={sections.quantities.approvedVariation} suffix={unit} testId='boq-detail-qty-variation' />
        <FigureRow label='Authorised (revised) quantity' figure={sections.quantities.authorised} suffix={unit} testId='boq-detail-qty-authorised' />
        <FigureRow label='Mapped to activities' figure={sections.quantities.mapped} suffix={unit} testId='boq-detail-qty-mapped' />
        <FigureRow label='Unallocated' figure={sections.quantities.unallocated} suffix={unit} testId='boq-detail-qty-unallocated' />
        {/* PC-6: the five quantities and the committed quantity, from the
            quantity views — five truths, never merged. Until that read
            answers, the detail's own installed / paid rows say what they can. */}
        {quantities?.state === 'ok' ? null : (
          <>
            <FigureRow label='Installed' figure={sections.quantities.installed} testId='boq-detail-qty-installed' />
            <FigureRow label='Paid' figure={sections.quantities.paid} testId='boq-detail-qty-paid' />
          </>
        )}
        <RecordQuantities projectId={projectId} kind='boq_item' id={detail.id} testId='boq-detail-quantities-pc6' />
        <FigureRow label='Forecast' figure={sections.quantities.forecast} testId='boq-detail-qty-forecast' />
      </DetailSection>

      <DetailSection title='Money' testId='boq-detail-money'>
        <FigureRow label='Rate' figure={sections.money.rate} format='money' currency={currency} testId='boq-detail-rate' />
        <FigureRow label='Amount' figure={sections.money.amount} format='money' currency={currency} testId='boq-detail-amount' />
        <FigureRow label='Approved allocated' figure={sections.money.approvedAllocated} format='money' currency={currency} testId='boq-detail-allocated' />
        <FigureRow label='Earned value (as of now)' figure={sections.money.earnedValue} format='money' currency={currency} testId='boq-detail-ev' />
        <FigureRow label='Forecast' figure={sections.money.forecast} testId='boq-detail-money-forecast' />
      </DetailSection>

      <DetailSection title='Certification' testId='boq-detail-certification'>
        {sections.certification.allowed ? (
          <>
            <FigureRow label='Certified quantity' figure={sections.certification.certifiedQuantity} suffix={unit} testId='boq-detail-certified-qty' />
            <FigureRow label='Certified amount' figure={sections.certification.certifiedAmount} format='money' currency={currency} testId='boq-detail-certified-amount' />
            {sections.certification.note && (
              <p className='text-xs text-muted-foreground' data-testid='boq-detail-certification-note'>
                {sections.certification.note}
              </p>
            )}
            <ul className='space-y-1 text-sm'>
              {sections.certification.lines.items.map((line) => (
                <li key={line.id} className='flex justify-between gap-3'>
                  <RecordLink href={line.href as string} testId={`boq-detail-ipc-${line.id}`}>
                    IPC {String(line.period ?? '')} · {String(line.status ?? '')}
                  </RecordLink>
                  <span className='tabular-nums'>{formatQuantity(line.qty as number)}</span>
                </li>
              ))}
            </ul>
            <CappedNote shown={sections.certification.lines.items.length} total={sections.certification.lines.total} viewAll={sections.certification.lines.viewAll} />
          </>
        ) : (
          <Withheld section={sections.certification} testId='boq-detail-certification-withheld' />
        )}
      </DetailSection>

      <DetailSection title='Commitments' testId='boq-detail-commitments'>
        {sections.commitments.allowed ? (
          <>
            <FigureRow
              label={FINANCIAL_TERMS.baseCommitmentValue.label}
              hint={FINANCIAL_TERMS.baseCommitmentValue.hint}
              figure={sections.commitments.baseCommitmentValue}
              format='money'
              currency={currency}
              testId='boq-detail-base-commitment-value'
            />
            <ul className='space-y-1 text-sm'>
              {sections.commitments.lines.items.map((line) => {
                const commitment = line.commitment as { id: string; number?: string; title?: string; href?: string }
                return (
                  <li key={line.id} className='flex justify-between gap-3'>
                    <RecordLink href={commitment?.href} testId={`boq-detail-commitment-${commitment?.id}`}>
                      {[commitment?.number, commitment?.title].filter(Boolean).join(' · ') || 'Commitment'}
                    </RecordLink>
                    <span className='tabular-nums'>{formatMoney(currency, line.amount as number)}</span>
                  </li>
                )
              })}
            </ul>
          </>
        ) : (
          <Withheld section={sections.commitments} testId='boq-detail-commitments-withheld' />
        )}
      </DetailSection>

      <DetailSection title='Changes' testId='boq-detail-changes'>
        {sections.changes.allowed ? (
          sections.changes.changeOrders.items.length ? (
            <ul className='space-y-1 text-sm'>
              {sections.changes.changeOrders.items.map((order) => (
                <li key={order.id} className='flex justify-between gap-3'>
                  <RecordLink href={order.href as string} testId={`boq-detail-change-order-${order.id}`}>
                    {[order.ref, order.description].filter(Boolean).join(' · ')}
                  </RecordLink>
                  <Badge variant='outline' className='text-[10px]'>
                    {String(order.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No change order names this row.</Empty>
          )
        ) : (
          <Withheld section={sections.changes} testId='boq-detail-changes-withheld' />
        )}
      </DetailSection>

      {/* PC-7b: the exceptions the server lists on this row and its allocations. */}
      <RecordExceptionsSection
        projectId={projectId}
        recordType='boq_item'
        recordId={detail.id}
        testId='boq-detail-exceptions'
      />

      <DetailSection title='Procurement' testId='boq-detail-procurement'>
        {sections.procurement.allowed ? (
          sections.procurement.poLines.items.length ? (
            <ul className='space-y-1 text-sm'>
              {sections.procurement.poLines.items.map((line) => {
                const order = line.order as { id: string; ref?: string; href?: string } | null
                return (
                  <li key={line.id} className='flex flex-wrap justify-between gap-2'>
                    <RecordLink href={order?.href} testId={`boq-detail-po-${line.id}`}>
                      {order?.ref ?? 'Purchase order'} · {String(line.description ?? '')}
                    </RecordLink>
                    <span className='text-xs text-muted-foreground'>
                      {formatQuantity(line.receivedQty as number)} / {formatQuantity(line.orderedQty as number)} received
                    </span>
                    {typeof line.activityId === 'string' && (
                      <DrawerLink onClick={() => onOpenActivity(line.activityId as string)}>For activity</DrawerLink>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <Empty>No purchase order line names this row.</Empty>
          )
        ) : (
          <Withheld section={sections.procurement} />
        )}
      </DetailSection>

      <DetailSection title='Setup readiness' testId='boq-detail-readiness'>
        {sections.readiness.flags.length ? (
          <ul className='space-y-1 text-sm'>
            {sections.readiness.flags.map((flag, index) => (
              <li key={index}>
                <Badge variant={flag.severity === 'blocking' ? 'destructive' : 'outline'} className='mr-1 text-[10px]'>
                  {String(flag.severity)}
                </Badge>
                {String(flag.message ?? flag.code)}
              </li>
            ))}
          </ul>
        ) : sections.readiness.notItemised.length ? null : (
          <Empty>No setup check flags this row.</Empty>
        )}
        {sections.readiness.note && (
          <p className='text-xs text-muted-foreground' data-testid='boq-detail-readiness-not-itemised'>
            {sections.readiness.note}
          </p>
        )}
      </DetailSection>

      <DetailSection title='Documents & photos' testId='boq-detail-documents'>
        {sections.documents.attachments.items.length ? (
          <ul className='space-y-1 text-sm'>
            {sections.documents.attachments.items.map((attachment) => (
              <li key={attachment.id}>{String(attachment.fileName ?? attachment.caption ?? 'Attachment')}</li>
            ))}
          </ul>
        ) : (
          <Empty>No documents attached to this row.</Empty>
        )}
      </DetailSection>

      <DetailSection title='History' testId='boq-detail-history'>
        {sections.history.allowed ? (
          <HistoryList events={sections.history.events} />
        ) : (
          <Withheld section={sections.history} />
        )}
      </DetailSection>
    </div>
  )
}

export function BoqDetailDrawer({ projectId, itemId, onClose, onOpenActivity, back }: Props) {
  const { data: project } = useProject(projectId)
  const { data: detail, isLoading, error } = useBoqItemDetail(projectId, itemId)
  const currency = project?.currency ?? 'USD'
  const status = (error as { response?: { status?: number; data?: { error?: { message?: string } } } } | null)?.response
  return (
    <Sheet open={Boolean(itemId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className='w-full sm:max-w-2xl' data-testid='boq-detail-drawer' data-item-id={itemId ?? ''}>
        <SheetHeader>
          {back && (
            <Button
              variant='ghost'
              size='sm'
              className='-ml-2 w-fit'
              onClick={back.onBack}
              data-testid='detail-drawer-back'
            >
              <ArrowLeft className='mr-1 h-4 w-4' />
              Back to {back.label}
            </Button>
          )}
          <SheetTitle data-testid='boq-detail-title'>
            {detail ? `${detail.header.code} · ${detail.header.description ?? ''}` : 'BOQ item'}
          </SheetTitle>
          <SheetDescription>
            {detail
              ? [
                  detail.header.section,
                  detail.header.unit && `Unit ${detail.header.unit}`,
                  detail.header.revision &&
                    `Revision ${detail.header.revision.revisionNumber ?? ''} (${detail.header.revision.status ?? ''})`,
                  detail.header.baselineLock?.locked ? 'Baseline locked' : null,
                  detail.header.supersededAt ? `Superseded ${formatDate(detail.header.supersededAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Loading the row'}
          </SheetDescription>
        </SheetHeader>
        <div className='flex-1 overflow-y-auto px-4 pb-6'>
          {isLoading ? (
            <div className='space-y-2'>
              <Skeleton className='h-24 w-full' />
              <Skeleton className='h-40 w-full' />
            </div>
          ) : error ? (
            <p className='text-sm text-destructive' data-testid='boq-detail-error'>
              {status?.data?.error?.message ?? 'This BOQ item could not be read.'}
            </p>
          ) : detail ? (
            <BoqDetailBody projectId={projectId} detail={detail} currency={currency} onOpenActivity={onOpenActivity} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
