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
import { HistoryList, StructureRows } from '@/features/boq/components/boq-detail-drawer'
import type { ControlsSectionDenied } from '@/features/boq/data/schema'
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
import { FINANCIAL_TERMS } from '@/lib/financial-terms'
import { useActivityDetail } from '@/features/controls/hooks/use-controls-detail'
import { useProject } from '@/features/projects/hooks/use-projects'
import type { ActivityDetail } from '../data/schema'

/**
 * An activity's whole story (PC-5): its dates and float, the BOQ rows it
 * carries and the quantity mapped to it, how progress is measured and where
 * the approved figure came from, what it has cost, what changed it, what is
 * being bought for it, its quality records, ties and documents. A BOQ row
 * opens the BOQ item's drawer in place, and that drawer leads back here.
 *
 * The bill's side (allocations, mapped quantity, the allocation budget and
 * EV) is sent only to a BOQ reader; anyone else sees the server's reason.
 */

type Props = {
  projectId: string
  activityId: string | null
  onClose: () => void
  onOpenBoqItem: (itemId: string) => void
  onOpenActivity: (activityId: string) => void
  back?: { label: string; onBack: () => void } | null
}

type Row = { id: string } & Record<string, unknown>

const text = (value: unknown) => (value == null ? '' : String(value))

function RecordList({
  list,
  render,
  empty,
  testId,
}: {
  list: ControlsSectionDenied | { allowed: true; items: Row[] }
  render: (row: Row) => React.ReactNode
  empty: string
  testId?: string
}) {
  if (!list.allowed) return <Withheld section={list} testId={testId ? `${testId}-withheld` : undefined} />
  if (!list.items.length) return <Empty>{empty}</Empty>
  return (
    <ul className='space-y-1 text-sm' data-testid={testId}>
      {list.items.map((row) => (
        <li key={row.id} className='flex flex-wrap justify-between gap-2'>
          {render(row)}
        </li>
      ))}
    </ul>
  )
}

/** Part of a list the server left out, with its reason: "—", never "none". */
function PartlyWithheld({ reason, testId }: { reason: string; testId: string }) {
  return (
    <p className='text-sm text-muted-foreground' data-testid={testId} data-withheld-module='boq'>
      — {reason}
    </p>
  )
}

function ActivityDetailBody({
  detail,
  currency,
  onOpenBoqItem,
  onOpenActivity,
}: {
  detail: ActivityDetail
  currency: string
  onOpenBoqItem: (itemId: string) => void
  onOpenActivity: (activityId: string) => void
}) {
  const { header, sections } = detail
  const method = sections.progress.allowed
    ? (sections.progress.method as { method?: string; plannedQuantity?: number; quantityUnit?: string } | null)
    : null
  return (
    <div className='space-y-3'>
      <DetailSection title='Schedule' testId='activity-detail-schedule'>
        <dl className='grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-sm'>
          <dt className='text-muted-foreground'>Planned</dt>
          <dd>{formatDate(header.startDate)} → {formatDate(header.endDate)}</dd>
          <dt className='text-muted-foreground'>Early / late finish</dt>
          <dd>{formatDate(header.earlyFinishDate)} / {formatDate(header.lateFinishDate)}</dd>
          <dt className='text-muted-foreground'>Baseline</dt>
          <dd>
            {header.baselineStartDate || header.baselineFinishDate
              ? `${formatDate(header.baselineStartDate)} → ${formatDate(header.baselineFinishDate)}`
              : 'No baseline dates'}
          </dd>
          <dt className='text-muted-foreground'>Actual</dt>
          <dd>{formatDate(header.actualStart)} → {formatDate(header.actualFinish)}</dd>
          <dt className='text-muted-foreground'>Total float</dt>
          <dd data-testid='activity-detail-float'>
            {header.totalFloat == null ? '—' : `${formatQuantity(header.totalFloat)} d`}
            {header.isCritical && (
              <Badge variant='destructive' className='ml-2 px-1 py-0 text-[10px]'>
                Critical
              </Badge>
            )}
          </dd>
        </dl>
      </DetailSection>

      <DetailSection title='Structure' testId='activity-detail-structure'>
        <StructureRows structure={sections.structure} />
      </DetailSection>

      <DetailSection title='BOQ allocations' testId='activity-detail-mapping'>
        {sections.mapping.allowed ? (
          <>
            <FigureRow label='Mapped quantity' figure={sections.mapping.mappedQuantity} testId='activity-detail-mapped-qty' />
            <FigureRow label='Budget (approved allocations)' figure={sections.mapping.budget} format='money' currency={currency} testId='activity-detail-budget' />
            <FigureRow label='Generated budget' figure={sections.mapping.generatedBudget} format='money' currency={currency} testId='activity-detail-generated-budget' />
            <FigureRow label='Earned value (as of now)' figure={sections.mapping.earnedValue} format='money' currency={currency} testId='activity-detail-ev' />
            {sections.mapping.allocations.items.length ? (
              <table className='w-full text-sm'>
                <thead className='text-left text-xs text-muted-foreground'>
                  <tr>
                    <th className='py-1 pr-2 font-medium'>BOQ item</th>
                    <th className='py-1 pr-2 text-right font-medium'>Qty</th>
                    <th className='py-1 pr-2 text-right font-medium'>Amount</th>
                    <th className='py-1 text-right font-medium'>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.mapping.allocations.items.map((row) => (
                    <tr key={row.allocationId} className='border-t align-top'>
                      <td className='py-1.5 pr-2'>
                        <DrawerLink onClick={() => onOpenBoqItem(row.boqItem.id)} testId={`activity-detail-boq-${row.boqItem.id}`}>
                          {[row.boqItem.code, row.boqItem.description].filter(Boolean).join(' · ')}
                        </DrawerLink>
                      </td>
                      <td className='py-1.5 pr-2 text-right tabular-nums' title={row.authorisedQuantity.basis}>
                        {formatQuantity(row.quantity.value)} {row.boqItem.unit ?? ''}
                        {row.authorisedQuantity.value !== row.quantity.value && (
                          <span className='block text-[10px] text-muted-foreground'>
                            authorised {formatQuantity(row.authorisedQuantity.value)}
                          </span>
                        )}
                      </td>
                      <td className='py-1.5 pr-2 text-right tabular-nums'>{formatMoney(currency, row.amount.value)}</td>
                      <td className='py-1.5 text-right'>
                        <Badge variant='outline' className='text-[10px]'>{row.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>No BOQ row is allocated to this activity yet.</Empty>
            )}
            <CappedNote
              shown={sections.mapping.allocations.items.length}
              total={sections.mapping.allocations.total}
              viewAll={sections.mapping.allocations.viewAll}
              testId='activity-detail-mapping-view-all'
            />
          </>
        ) : (
          <Withheld section={sections.mapping} testId='activity-detail-mapping-withheld' />
        )}
      </DetailSection>

      <DetailSection title='Progress' testId='activity-detail-progress'>
        {sections.progress.allowed ? (
          <>
            <dl className='grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-sm'>
              <dt className='text-muted-foreground'>Progress method</dt>
              <dd data-testid='activity-detail-progress-method'>
                {method?.method ? method.method.replace(/_/g, ' ') : 'Not set (percent complete)'}
              </dd>
              <dt className='text-muted-foreground'>Progress source</dt>
              <dd data-testid='activity-detail-progress-source'>
                {sections.progress.progressSource ?? 'No approved progress yet'}
              </dd>
            </dl>
            <FigureRow label='Approved progress' figure={sections.progress.pctComplete} format='percent' testId='activity-detail-pct' />
            <FigureRow label='Installed quantity' figure={sections.progress.installedQuantity} testId='activity-detail-installed' />
            {sections.progress.approvedHistory.items.length ? (
              <ul className='space-y-1 text-sm' data-testid='activity-detail-progress-history'>
                {sections.progress.approvedHistory.items.map((row) => (
                  <li key={row.id} className='flex justify-between gap-3'>
                    <span>
                      {formatQuantity(row.pctComplete as number)}% · {text(row.progressMethod ?? row.source)}
                    </span>
                    <span className='text-xs text-muted-foreground'>{formatDate(row.approvedAt as string)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No approved progress yet.</Empty>
            )}
            <CappedNote
              shown={sections.progress.approvedHistory.items.length}
              total={sections.progress.approvedHistory.total}
            />
          </>
        ) : (
          <Withheld section={sections.progress} />
        )}
      </DetailSection>

      <DetailSection title='Cost' testId='activity-detail-cost'>
        {sections.cost.allowed ? (
          <>
            <FigureRow label={FINANCIAL_TERMS.executedCommitments.label} figure={sections.cost.committed} format='money' currency={currency} testId='activity-detail-committed' />
            <FigureRow label='Actual cost' figure={sections.cost.actual} format='money' currency={currency} testId='activity-detail-actual' />
            <FigureRow label='Forecast' figure={sections.cost.forecast} format='money' currency={currency} testId='activity-detail-forecast' />
            <RecordLink href={sections.cost.href} testId='activity-detail-cost-link'>
              Open in Cost
            </RecordLink>
          </>
        ) : (
          <Withheld section={sections.cost} testId='activity-detail-cost-withheld' />
        )}
      </DetailSection>

      <DetailSection title='Certification' testId='activity-detail-certification'>
        {sections.certification.allowed ? (
          <>
            <FigureRow label='Certified on its allocations' figure={sections.certification.certifiedAmount} format='money' currency={currency} testId='activity-detail-certified' />
            <ul className='space-y-1 text-sm'>
              {sections.certification.lines.items.map((line) => (
                <li key={line.id}>
                  <RecordLink href={line.href as string}>
                    IPC {text(line.period)} · {text(line.status)} · {formatMoney(currency, line.currentCert as number)}
                  </RecordLink>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Withheld section={sections.certification} testId='activity-detail-certification-withheld' />
        )}
      </DetailSection>

      <DetailSection title='Changes' testId='activity-detail-changes'>
        {sections.changes.allowed ? (
          <>
            {sections.changes.changeOrders && 'items' in sections.changes.changeOrders ? (
              sections.changes.changeOrders.items.length ? (
                <ul className='space-y-2 text-sm'>
                  {sections.changes.changeOrders.items.map((order) => {
                    const links = (order.allocationLinks as Row[] | undefined) ?? []
                    return (
                      <li key={order.id}>
                        <div className='flex justify-between gap-2'>
                          <RecordLink href={order.href as string} testId={`activity-detail-change-order-${order.id}`}>
                            {[order.ref, order.description].filter(Boolean).map(text).join(' · ')}
                          </RecordLink>
                          <Badge variant='outline' className='text-[10px]'>{text(order.status)}</Badge>
                        </div>
                        {links.map((link) =>
                          typeof link.boqItemId === 'string' ? (
                            <div key={link.id} className='pl-3 text-xs'>
                              <DrawerLink onClick={() => onOpenBoqItem(link.boqItemId as string)} testId={`activity-detail-change-boq-${link.id}`}>
                                BOQ row · {formatQuantity(link.quantity as number)}
                              </DrawerLink>
                            </div>
                          ) : null
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : sections.changes.changeOrders.boqWithheld ? null : (
                <Empty>No change order touches this activity.</Empty>
              )
            ) : (
              <Withheld section={sections.changes.changeOrders as ControlsSectionDenied} />
            )}
            {sections.changes.changeOrders &&
              'items' in sections.changes.changeOrders &&
              sections.changes.changeOrders.boqWithheld && (
                // Orders reached through a BOQ allocation are left out for a
                // member who may not read the BOQ: say so, never "none".
                <PartlyWithheld
                  reason={sections.changes.changeOrders.boqWithheld.reason}
                  testId='activity-detail-change-orders-boq-withheld'
                />
              )}
            {sections.changes.changeEvents && 'items' in sections.changes.changeEvents ? (
              sections.changes.changeEvents.items.length ? (
                <ul className='space-y-1 text-sm'>
                  {sections.changes.changeEvents.items.map((event) => (
                    <li key={event.id}>
                      <RecordLink href={event.href as string}>
                        Change event {text(event.number)} · {text(event.title)}
                      </RecordLink>
                    </li>
                  ))}
                </ul>
              ) : null
            ) : null}
          </>
        ) : (
          <Withheld section={sections.changes} />
        )}
      </DetailSection>

      <DetailSection title='Procurement' testId='activity-detail-procurement'>
        {sections.procurement.allowed ? (
          <>
            {[...sections.procurement.packages, ...sections.procurement.orders].length === 0 &&
            sections.procurement.poLines.length === 0 &&
            sections.procurement.longLeadItems.length === 0 ? (
              <Empty>Nothing is being bought for this activity.</Empty>
            ) : (
              <ul className='space-y-1 text-sm'>
                {sections.procurement.packages.map((row) => (
                  <li key={row.id}>
                    <RecordLink href={row.href as string}>Package {text(row.packageNumber)} · {text(row.title)}</RecordLink>
                  </li>
                ))}
                {sections.procurement.orders.map((row) => (
                  <li key={row.id}>
                    <RecordLink href={row.href as string}>Order {text(row.ref)} · {text(row.item)} ({text(row.status)})</RecordLink>
                  </li>
                ))}
                {sections.procurement.poLines.map((row) => {
                  const order = row.order as { href?: string; ref?: string } | null
                  return (
                    <li key={row.id} className='flex flex-wrap justify-between gap-2'>
                      <RecordLink href={order?.href}>PO {order?.ref ?? ''} · {text(row.description)}</RecordLink>
                      {typeof row.boqItemId === 'string' && (
                        <DrawerLink onClick={() => onOpenBoqItem(row.boqItemId as string)}>BOQ row</DrawerLink>
                      )}
                    </li>
                  )
                })}
                {sections.procurement.longLeadItems.map((row) => (
                  <li key={row.id}>
                    <RecordLink href={row.href as string}>Long lead · {text(row.item)} ({text(row.status)})</RecordLink>
                  </li>
                ))}
              </ul>
            )}
            {sections.procurement.leadTimeAlerts.length > 0 && (
              <p className='text-xs text-amber-700 dark:text-amber-300'>
                {sections.procurement.leadTimeAlerts.length} open lead-time alert
                {sections.procurement.leadTimeAlerts.length === 1 ? '' : 's'}
              </p>
            )}
          </>
        ) : (
          <Withheld section={sections.procurement} />
        )}
      </DetailSection>

      <DetailSection title='Quality' testId='activity-detail-quality'>
        {sections.quality.allowed ? (
          <div className='space-y-2'>
            <RecordList
              list={sections.quality.ncrs}
              empty='No NCR on this activity.'
              testId='activity-detail-ncrs'
              render={(row) => (
                <>
                  <RecordLink href={row.href as string} testId={`activity-detail-ncr-${row.id}`}>
                    NCR {text(row.ref)} · {text(row.description)}
                  </RecordLink>
                  <Badge variant='outline' className='text-[10px]'>{text(row.status)}</Badge>
                </>
              )}
            />
            <RecordList
              list={sections.quality.itps}
              empty='No inspection on this activity.'
              render={(row) => (
                <RecordLink href={row.href as string}>ITP {text(row.ref)} · {text(row.title)}</RecordLink>
              )}
            />
            <RecordList
              list={sections.quality.punchItems}
              empty='No punch item on this activity.'
              render={(row) => (
                <RecordLink href={row.href as string}>Punch {text(row.number)} · {text(row.title)}</RecordLink>
              )}
            />
          </div>
        ) : (
          <Withheld section={sections.quality} />
        )}
      </DetailSection>

      <DetailSection title='Constraints and logic' testId='activity-detail-constraints'>
        {sections.constraints.note && <p className='text-xs text-muted-foreground'>{sections.constraints.note}</p>}
        {[
          ['Predecessors', sections.constraints.predecessors],
          ['Successors', sections.constraints.successors],
        ].map(([label, rows]) => (
          <div key={label as string}>
            <p className='text-xs font-medium text-muted-foreground'>{label as string}</p>
            {(rows as Row[]).length ? (
              <ul className='space-y-0.5 text-sm'>
                {(rows as Row[]).map((row) => {
                  const other = row.activity as { id: string; code?: string | null; name?: string } | null
                  return (
                    <li key={row.id}>
                      {other ? (
                        <DrawerLink onClick={() => onOpenActivity(other.id)}>
                          {[other.code, other.name].filter(Boolean).join(' · ')}
                        </DrawerLink>
                      ) : null}{' '}
                      <span className='text-xs text-muted-foreground'>
                        {text(row.relationshipType)}
                        {row.lagDays ? ` +${text(row.lagDays)}d` : ''}
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <Empty>None</Empty>
            )}
          </div>
        ))}
        <RecordList
          list={sections.constraints.lookahead}
          empty='No open lookahead constraint.'
          render={(row) => (
            <RecordLink href={row.href as string}>
              {text(row.name)} · {text(row.constraint)}
            </RecordLink>
          )}
        />
      </DetailSection>

      <DetailSection title='Documents & photos' testId='activity-detail-documents'>
        {sections.documents.attachments.items.length + sections.documents.photos.items.length +
          sections.documents.linkedRecords.length ===
        0 ? (
          <Empty>No documents, photos or linked records.</Empty>
        ) : (
          <ul className='space-y-1 text-sm'>
            {[...sections.documents.attachments.items, ...sections.documents.photos.items].map((row) => (
              <li key={row.id}>
                {text(row.role) === 'photo' ? 'Photo · ' : ''}
                {text(row.fileName ?? row.caption ?? 'Attachment')}
              </li>
            ))}
            {sections.documents.linkedRecords.map((row) => (
              <li key={row.id}>
                <RecordLink href={row.href as string}>
                  {text(row.recordType).replace(/_/g, ' ')} · {text(row.relationType)}
                </RecordLink>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection title='History' testId='activity-detail-history'>
        {sections.history.allowed ? (
          <>
            {sections.history.note && <p className='text-xs text-muted-foreground'>{sections.history.note}</p>}
            <HistoryList events={sections.history.events} />
            {sections.history.boqWithheld && (
              <PartlyWithheld reason={sections.history.boqWithheld.reason} testId='activity-detail-history-boq-withheld' />
            )}
          </>
        ) : (
          <Withheld section={sections.history} />
        )}
      </DetailSection>
    </div>
  )
}

export function ActivityDetailDrawer({
  projectId,
  activityId,
  onClose,
  onOpenBoqItem,
  onOpenActivity,
  back,
}: Props) {
  const { data: project } = useProject(projectId)
  const { data: detail, isLoading, error } = useActivityDetail(projectId, activityId)
  const currency = project?.currency ?? 'USD'
  const response = (error as { response?: { data?: { error?: { message?: string } } } } | null)?.response
  return (
    <Sheet open={Boolean(activityId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className='w-full sm:max-w-2xl' data-testid='activity-detail-drawer' data-activity-id={activityId ?? ''}>
        <SheetHeader>
          {back && (
            <Button variant='ghost' size='sm' className='-ml-2 w-fit' onClick={back.onBack} data-testid='detail-drawer-back'>
              <ArrowLeft className='mr-1 h-4 w-4' />
              Back to {back.label}
            </Button>
          )}
          <SheetTitle data-testid='activity-detail-title'>
            {detail ? [detail.header.code, detail.header.name].filter(Boolean).join(' · ') : 'Activity'}
          </SheetTitle>
          <SheetDescription>
            {detail
              ? [
                  detail.header.category,
                  detail.header.status && detail.header.status.replace(/_/g, ' '),
                  detail.header.isMilestone ? 'Milestone' : null,
                  detail.header.duration != null ? `${formatQuantity(detail.header.duration)} d` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Loading the activity'}
          </SheetDescription>
        </SheetHeader>
        <div className='flex-1 overflow-y-auto px-4 pb-6'>
          {isLoading ? (
            <div className='space-y-2'>
              <Skeleton className='h-24 w-full' />
              <Skeleton className='h-40 w-full' />
            </div>
          ) : error ? (
            <p className='text-sm text-destructive' data-testid='activity-detail-error'>
              {response?.data?.error?.message ?? 'This activity could not be read.'}
            </p>
          ) : detail ? (
            <ActivityDetailBody
              detail={detail}
              currency={currency}
              onOpenBoqItem={onOpenBoqItem}
              onOpenActivity={onOpenActivity}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
