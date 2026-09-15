import { useState } from 'react'
import { toast } from 'sonner'
import {
  hasMoneyPrecision,
  MONEY_INPUT_STEP,
  MONEY_PRECISION_MESSAGE,
  toMoneyNumber,
} from '@/lib/money'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useBudgetLines } from '@/features/cost/hooks/use-budget'
import { DocumentPicker } from './document-picker'
import { RaisedByPicker } from './raised-by-picker'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ScheduleActivity } from '@/features/schedule/data/schema'
import type { ChangeOrderRecord } from '../hooks/use-commercial'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  activities: ScheduleActivity[]
  initial?: ChangeOrderRecord | null
  isSaving?: boolean
  projectId: string
  onSubmit: (payload: {
    description: string
    budgetLineId?: string | null
    budgetAllocations?: Array<{ budgetLineId: string; amount: number }>
    category?: string
    value?: number
    scheduleImpact?: number
    scheduleImpactSummary?: string | null
    costImpactSummary?: string | null
    activityId?: string | null
    activityLinks?: Array<{
      activityId: string
      relationType: string
      scheduleImpactDays: number
      costImpact?: number
      impactBasis?: string | null
    }>
    supportingDocumentIds?: string[]
    submittedDate?: string
    raisedBy?: string
  }) => Promise<void>
}

type ActivityImpactState = {
  scheduleImpactDays: string
  costImpact: string
  impactBasis: string
}

type FormState = {
  description: string
  category: string
  value: string
  scheduleImpact: string
  scheduleImpactSummary: string
  costImpactSummary: string
  activityIds: string[]
  activityImpacts: Record<string, ActivityImpactState>
  documentIds: string[]
  submittedDate: string
  raisedBy: string
  budgetLineId: string
  budgetSplit: Array<{ budgetLineId: string; amount: string }>
}

const NO_LINE = '__change_orders_line__'

const defaultState: FormState = {
  description: '',
  category: '',
  value: '0',
  scheduleImpact: '0',
  scheduleImpactSummary: '',
  costImpactSummary: '',
  activityIds: [],
  activityImpacts: {},
  documentIds: [],
  submittedDate: '',
  raisedBy: '',
  budgetLineId: '',
  budgetSplit: [],
}

const toFormState = (initial?: ChangeOrderRecord | null): FormState => {
  if (!initial) return defaultState
  const activityLinks = initial.activityLinks || []
  const activityImpacts = Object.fromEntries(
    activityLinks.map((link) => [
      link.activityId,
      {
        scheduleImpactDays: String(
          link.scheduleImpactDays ?? initial.scheduleImpact ?? 0
        ),
        costImpact: String(link.costImpact ?? 0),
        impactBasis: link.impactBasis || '',
      },
    ])
  )

  return {
    description: initial.description,
    category: initial.category || '',
    value: String(initial.value || 0),
    scheduleImpact: String(initial.scheduleImpact || 0),
    scheduleImpactSummary: initial.scheduleImpactSummary || '',
    costImpactSummary: initial.costImpactSummary || '',
    activityIds: activityLinks.length
      ? activityLinks.map((link) => link.activityId).filter(Boolean)
      : initial.activityId
        ? [initial.activityId]
        : [],
    activityImpacts,
    documentIds:
      initial.attachmentRefs
        ?.map((attachment) => attachment.documentId)
        .filter((id): id is string => Boolean(id)) || [],
    submittedDate: initial.submittedDate
      ? new Date(initial.submittedDate).toISOString().slice(0, 10)
      : '',
    raisedBy: initial.raisedBy || '',
    budgetLineId: initial.budgetLineId || '',
    budgetSplit: (initial.budgetAllocationsJson || []).map((row) => ({
      budgetLineId: row.budgetLineId,
      amount: String(row.amount),
    })),
  }
}

export function ChangeOrderForm({
  projectId,
  open,
  onOpenChange,
  activities,
  initial,
  isSaving,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<FormState>(() => toFormState(initial))
  const { data: budgetLinesData } = useBudgetLines(projectId)
  const budgetLines = budgetLinesData?.items ?? []
  const lineLabel = (lineId: string) => {
    const line = budgetLines.find((row) => row.id === lineId)
    if (!line) return lineId
    return `${line.costCode?.code ?? '—'} · ${line.description || line.costType}`
  }
  const splitTotal = form.budgetSplit.reduce(
    (acc, row) => acc + (Number(row.amount) || 0),
    0
  )
  const splitMismatch =
    form.budgetSplit.length > 0 &&
    Math.abs(splitTotal - (Number(form.value) || 0)) > 0.005
  const selectedActivityIds = new Set(form.activityIds)
  const selectedActivities = form.activityIds
    .map((id) => activities.find((activity) => activity.id === id))
    .filter(Boolean) as ScheduleActivity[]

  const impactFor = (activityId: string): ActivityImpactState =>
    form.activityImpacts[activityId] || {
      scheduleImpactDays: form.scheduleImpact || '0',
      costImpact: '0',
      impactBasis: '',
    }

  const updateImpact = (
    activityId: string,
    patch: Partial<ActivityImpactState>
  ) => {
    setForm((prev) => ({
      ...prev,
      activityImpacts: {
        ...prev.activityImpacts,
        [activityId]: {
          ...(prev.activityImpacts[activityId] || {
            scheduleImpactDays: prev.scheduleImpact || '0',
            costImpact: '0',
            impactBasis: '',
          }),
          ...patch,
        },
      },
    }))
  }

  const documentIds = form.documentIds

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>
            {initial ? 'Edit Change Order' : 'Add Change Order'}
          </DialogTitle>
          <DialogDescription>
            Register variation/change orders with value and schedule impact.
          </DialogDescription>
        </DialogHeader>

        <div className='grid grid-cols-2 gap-3'>
          <div className='col-span-2 grid gap-1.5'>
            <Label htmlFor='co-description'>Description</Label>
            <Textarea
              id='co-description'
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
            />
          </div>

          <div className='grid gap-1.5'>
            <Label htmlFor='co-category'>Category</Label>
            <Input
              id='co-category'
              value={form.category}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, category: e.target.value }))
              }
              placeholder='Variation, Claims, etc.'
            />
          </div>

          <div className='grid gap-1.5'>
            <Label htmlFor='co-value'>Value</Label>
            <Input
              id='co-value'
              type='number'
              min={0}
              step={MONEY_INPUT_STEP}
              value={form.value}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, value: e.target.value }))
              }
            />
          </div>

          <div className='grid gap-1.5'>
            <Label htmlFor='co-impact'>Schedule Impact (days)</Label>
            <Input
              id='co-impact'
              type='number'
              value={form.scheduleImpact}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, scheduleImpact: e.target.value }))
              }
            />
          </div>

          <div className='col-span-2 grid gap-1.5 sm:col-span-1'>
            <Label htmlFor='co-schedule-summary'>Schedule Impact Summary</Label>
            <Textarea
              id='co-schedule-summary'
              value={form.scheduleImpactSummary}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  scheduleImpactSummary: e.target.value,
                }))
              }
            />
          </div>

          <div className='col-span-2 grid gap-1.5 sm:col-span-1'>
            <Label htmlFor='co-cost-summary'>Cost Impact Summary</Label>
            <Textarea
              id='co-cost-summary'
              value={form.costImpactSummary}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  costImpactSummary: e.target.value,
                }))
              }
            />
          </div>

          <div className='grid gap-1.5'>
            <Label htmlFor='co-submitted-date'>Submitted Date</Label>
            <Input
              id='co-submitted-date'
              type='date'
              value={form.submittedDate}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, submittedDate: e.target.value }))
              }
            />
          </div>

          <div className='grid gap-1.5'>
            <Label htmlFor='co-raised-by'>Raised By</Label>
            {/* A known person or party is picked, not typed; "Other" keeps a
                free-text originator for someone outside the project (Phase 22A). */}
            <RaisedByPicker
              id='co-raised-by'
              projectId={projectId}
              value={form.raisedBy}
              onChange={(raisedBy) => setForm((prev) => ({ ...prev, raisedBy }))}
            />
          </div>

          <div className='col-span-2 grid gap-1.5'>
            <Label>Affected Activities</Label>
            <div className='grid max-h-44 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2'>
              {activities.map((activity) => (
                <label
                  key={activity.id}
                  className='flex items-start gap-2 rounded-sm px-2 py-1 text-xs hover:bg-muted/60'
                >
                  <input
                    type='checkbox'
                    className='mt-0.5'
                    checked={selectedActivityIds.has(activity.id)}
                    onChange={(e) => {
                      setForm((prev) => {
                        const next = new Set(prev.activityIds)
                        const activityImpacts = { ...prev.activityImpacts }
                        if (e.target.checked) next.add(activity.id)
                        else {
                          next.delete(activity.id)
                          delete activityImpacts[activity.id]
                        }
                        if (e.target.checked && !activityImpacts[activity.id]) {
                          activityImpacts[activity.id] = {
                            scheduleImpactDays: prev.scheduleImpact || '0',
                            costImpact: '0',
                            impactBasis: '',
                          }
                        }
                        return {
                          ...prev,
                          activityIds: Array.from(next),
                          activityImpacts,
                        }
                      })
                    }}
                  />
                  <span className='min-w-0'>
                    <span className='block truncate font-medium'>
                      {activity.wbsCode ? `${activity.wbsCode} - ` : ''}
                      {activity.name}
                    </span>
                    <span className='text-muted-foreground'>
                      {activity.isCritical ? 'Critical' : 'Float'}
                    </span>
                  </span>
                </label>
              ))}
              {activities.length === 0 && (
                <p className='p-2 text-xs text-muted-foreground'>
                  No schedule activities available.
                </p>
              )}
            </div>
          </div>

          {selectedActivities.length > 0 && (
            <div className='col-span-2 grid gap-2'>
              <Label>Activity Impact Analysis</Label>
              <div className='grid max-h-56 gap-2 overflow-y-auto rounded-md border p-2'>
                {selectedActivities.map((activity) => {
                  const impact = impactFor(activity.id)
                  return (
                    <div
                      key={activity.id}
                      className='grid gap-2 rounded-sm border bg-muted/20 p-2 sm:grid-cols-[minmax(0,1fr)_110px_130px]'
                    >
                      <div className='min-w-0'>
                        <p className='truncate text-xs font-medium'>
                          {activity.wbsCode ? `${activity.wbsCode} - ` : ''}
                          {activity.name}
                        </p>
                        <Input
                          className='mt-2 h-8 text-xs'
                          value={impact.impactBasis}
                          onChange={(e) =>
                            updateImpact(activity.id, {
                              impactBasis: e.target.value,
                            })
                          }
                          placeholder='Impact basis'
                        />
                      </div>
                      <div className='grid gap-1'>
                        <Label className='text-xs'>Days</Label>
                        <Input
                          className='h-8'
                          type='number'
                          value={impact.scheduleImpactDays}
                          onChange={(e) =>
                            updateImpact(activity.id, {
                              scheduleImpactDays: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className='grid gap-1'>
                        <Label className='text-xs'>Cost</Label>
                        <Input
                          className='h-8'
                          type='number'
                          min={0}
                          step={MONEY_INPUT_STEP}
                          value={impact.costImpact}
                          onChange={(e) =>
                            updateImpact(activity.id, {
                              costImpact: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className='col-span-2 grid gap-1.5' data-testid='co-budget-allocation'>
            <Label>Budget allocation</Label>
            <p className='text-xs text-muted-foreground'>
              Where the approved value lands in the budget. Leave it on the
              project&apos;s &quot;Change orders&quot; line to decide later, name one
              line, or split it across lines.
            </p>
            {form.budgetSplit.length === 0 ? (
              <Select
                value={form.budgetLineId || NO_LINE}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    budgetLineId: value === NO_LINE ? '' : value,
                  }))
                }
              >
                <SelectTrigger data-testid='co-budget-line'>
                  <SelectValue placeholder='Change orders line (decide later)' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LINE}>
                    Change orders line (decide later)
                  </SelectItem>
                  {budgetLines.map((line) => (
                    <SelectItem key={line.id} value={line.id}>
                      {lineLabel(line.id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className='grid gap-1.5' data-testid='co-budget-split'>
                {form.budgetSplit.map((row, index) => (
                  <div key={index} className='flex items-center gap-2'>
                    <Select
                      value={row.budgetLineId || undefined}
                      onValueChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          budgetSplit: prev.budgetSplit.map((item, i) =>
                            i === index ? { ...item, budgetLineId: value } : item
                          ),
                        }))
                      }
                    >
                      <SelectTrigger className='flex-1'>
                        <SelectValue placeholder='Budget line' />
                      </SelectTrigger>
                      <SelectContent>
                        {budgetLines.map((line) => (
                          <SelectItem key={line.id} value={line.id}>
                            {lineLabel(line.id)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type='number'
                      step='0.01'
                      min='0'
                      className='w-36'
                      aria-label='Amount on this line'
                      value={row.amount}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          budgetSplit: prev.budgetSplit.map((item, i) =>
                            i === index ? { ...item, amount: e.target.value } : item
                          ),
                        }))
                      }
                    />
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          budgetSplit: prev.budgetSplit.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <p
                  className={
                    splitMismatch
                      ? 'text-xs text-destructive'
                      : 'text-xs text-muted-foreground'
                  }
                >
                  Split total {splitTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} of{' '}
                  {(Number(form.value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  {splitMismatch ? ' — the lines must add up to the value' : ''}
                </p>
              </div>
            )}
            <div>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                data-testid='co-budget-split-toggle'
                onClick={() =>
                  setForm((prev) =>
                    prev.budgetSplit.length
                      ? { ...prev, budgetSplit: [] }
                      : {
                          ...prev,
                          budgetLineId: '',
                          budgetSplit: [
                            { budgetLineId: prev.budgetLineId, amount: prev.value },
                            { budgetLineId: '', amount: '0' },
                          ],
                        }
                  )
                }
              >
                {form.budgetSplit.length ? 'One line instead' : 'Split across lines'}
              </Button>
            </div>
          </div>

          <div className='col-span-2 grid gap-1.5'>
            <Label>Supporting documents</Label>
            {/* Documents are picked from the project's register by reference,
                title, revision and status — never typed as ids (Phase 22A). */}
            <DocumentPicker
              projectId={projectId}
              value={form.documentIds}
              onChange={(documentIds) =>
                setForm((prev) => ({ ...prev, documentIds }))
              }
              initialLabels={Object.fromEntries(
                (initial?.attachmentRefs || [])
                  .filter((attachment) => attachment.documentId)
                  .map((attachment) => [
                    attachment.documentId as string,
                    attachment.fileName || attachment.description || 'Document',
                  ])
              )}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={isSaving || !form.description.trim()}
            onClick={async () => {
              if (!hasMoneyPrecision(form.value)) {
                toast.error(MONEY_PRECISION_MESSAGE)
                return
              }
              const invalidImpact = form.activityIds.some(
                (activityId) =>
                  !hasMoneyPrecision(impactFor(activityId).costImpact)
              )
              if (invalidImpact) {
                toast.error(MONEY_PRECISION_MESSAGE)
                return
              }
              if (form.budgetSplit.some((row) => !row.budgetLineId)) {
                toast.error('Pick a budget line for every row of the split')
                return
              }
              if (splitMismatch) {
                toast.error('The split must add up to the change order value')
                return
              }

              await onSubmit({
                budgetLineId: form.budgetSplit.length
                  ? null
                  : form.budgetLineId || null,
                budgetAllocations: form.budgetSplit.map((row) => ({
                  budgetLineId: row.budgetLineId,
                  amount: toMoneyNumber(row.amount),
                })),
                description: form.description.trim(),
                category: form.category || undefined,
                value: toMoneyNumber(form.value),
                scheduleImpact: Number(form.scheduleImpact) || 0,
                scheduleImpactSummary:
                  form.scheduleImpactSummary.trim() || null,
                costImpactSummary: form.costImpactSummary.trim() || null,
                activityId: form.activityIds[0] || null,
                activityLinks: form.activityIds.map((activityId) => {
                  const impact = impactFor(activityId)
                  return {
                    activityId,
                    relationType: 'affected',
                    scheduleImpactDays: Number(impact.scheduleImpactDays) || 0,
                    costImpact: toMoneyNumber(impact.costImpact),
                    impactBasis: impact.impactBasis || null,
                  }
                }),
                supportingDocumentIds: documentIds.length
                  ? documentIds
                  : undefined,
                submittedDate: form.submittedDate || undefined,
                raisedBy: form.raisedBy || undefined,
              })
            }}
          >
            {isSaving ? 'Saving...' : initial ? 'Save Changes' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
