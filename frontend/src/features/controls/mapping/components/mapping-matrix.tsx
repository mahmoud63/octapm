import { useCallback, useMemo, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { hasMoneyPrecision, MONEY_PRECISION_MESSAGE, toMoneyNumber } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Activity } from '@/features/activities/data/schema'
import {
  ruleLabel,
  useCreateAllocationDraft,
  useCreateAllocationsBulk,
  useSetMappingRules,
  useUpdateAllocationDraft,
  type AllocationDraftPayload,
  type CoverageItem,
  type CoverageSummary,
  type MappingAllocation,
  type MappingRule,
  type MappingSuggestion,
  type SuggestionsResponse,
} from '../hooks/use-mapping'

/**
 * The matrix: BOQ rows (grouped by the chosen structure dimension) against
 * activity columns, a cell per pair. Typing a figure into an empty cell
 * creates a draft; into a draft cell, edits it. Enter commits, Escape
 * cancels, the arrow keys move between cells. Suggestions show as ghost
 * cells and become drafts with their provenance when accepted. Selecting
 * rows and columns arms the bulk actions, which split each row's remaining
 * value across the chosen activities.
 */

export type CellMode = 'amount' | 'quantity'

type Props = {
  projectId: string
  currency: string
  coverage: CoverageSummary
  allocations: MappingAllocation[]
  activities: Activity[]
  suggestions: SuggestionsResponse | undefined
  showSuggestions: boolean
  selectedGroupKey: string | null
  mode: CellMode
  canCreate: boolean
  canUpdate: boolean
}

const UNGROUPED = '__none__'

const fmt = (value: number, digits: number) =>
  Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })

const activityLabel = (activity: Activity) =>
  activity.activityCode || activity.p6ActivityId || activity.id.slice(0, 8)

const durationDays = (activity: Activity) => {
  if (!activity.startDate || !activity.endDate) return 1
  const days =
    (new Date(activity.endDate).getTime() - new Date(activity.startDate).getTime()) /
    86_400_000
  return Number.isFinite(days) && days > 0 ? Math.round(days) : 1
}

/** Splits `total` (2 dp) across `weights`, the last share taking the rounding. */
const split = (total: number, weights: number[]) => {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0 || total <= 0) return weights.map(() => 0)
  const shares = weights.map((w) => Math.floor((total * w) / sum * 100) / 100)
  const used = shares.reduce((a, b) => a + b, 0)
  shares[shares.length - 1] = Math.round((shares[shares.length - 1] + total - used) * 100) / 100
  return shares
}

const statusTone: Record<string, string> = {
  draft: 'border-dashed border-primary/60 bg-primary/5 text-foreground',
  submitted: 'border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  approved: 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
}

type Editing = { itemId: string; activityId: string; value: string }

export function MappingMatrix({
  projectId,
  currency,
  coverage,
  allocations,
  activities,
  suggestions,
  showSuggestions,
  selectedGroupKey,
  mode,
  canCreate,
  canUpdate,
}: Props) {
  const createAllocation = useCreateAllocationDraft(projectId)
  const updateAllocation = useUpdateAllocationDraft(projectId)
  const bulkCreate = useCreateAllocationsBulk(projectId)
  const setRules = useSetMappingRules(projectId)

  const [editing, setEditing] = useState<Editing | null>(null)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [selectedActivities, setSelectedActivities] = useState<Set<string>>(new Set())
  const cellRefs = useRef(new Map<string, HTMLButtonElement>())

  const columns = useMemo(
    () =>
      [...activities].sort(
        (a, b) =>
          (a.wbsCode || '').localeCompare(b.wbsCode || '', undefined, { numeric: true }) ||
          activityLabel(a).localeCompare(activityLabel(b), undefined, { numeric: true })
      ),
    [activities]
  )

  const cellByPair = useMemo(() => {
    const map = new Map<string, MappingAllocation>()
    for (const row of allocations) {
      if (!row.isActive || row.status === 'rejected') continue
      map.set(`${row.boqItemId}:${row.activityId}`, row)
    }
    return map
  }, [allocations])

  const suggestionByPair = useMemo(() => {
    const map = new Map<string, MappingSuggestion>()
    if (!showSuggestions || !suggestions) return map
    for (const suggestion of suggestions.suggestions) {
      map.set(`${suggestion.boqItemId}:${suggestion.activityId}`, suggestion)
    }
    return map
  }, [suggestions, showSuggestions])

  const groups = useMemo(() => {
    const labelByKey = new Map(coverage.groups.map((g) => [g.key, g.label]))
    const rowsByKey = new Map<string, CoverageItem[]>()
    for (const item of coverage.items) {
      const key = coverage.groupBy === 'none' ? UNGROUPED : (item.groupKey ?? UNGROUPED)
      if (selectedGroupKey && key !== selectedGroupKey) continue
      if (!rowsByKey.has(key)) rowsByKey.set(key, [])
      rowsByKey.get(key)!.push(item)
    }
    return [...rowsByKey.entries()].map(([key, items]) => ({
      key,
      label:
        coverage.groupBy === 'none'
          ? null
          : (labelByKey.get(key) ?? (key === UNGROUPED ? 'Unassigned' : key)),
      items,
    }))
  }, [coverage, selectedGroupKey])

  const remainingOf = (item: CoverageItem) =>
    mode === 'amount'
      ? Math.max(0, Math.round((item.amount - item.activeAllocatedAmount) * 100) / 100)
      : Math.max(0, Math.round((item.quantity - item.activeAllocatedQuantity) * 1000) / 1000)

  const focusCell = useCallback((itemId: string, activityId: string) => {
    cellRefs.current.get(`${itemId}:${activityId}`)?.focus()
  }, [])

  const moveFocus = (itemId: string, activityId: string, dx: number, dy: number) => {
    const rows = groups.flatMap((g) => g.items)
    const r = rows.findIndex((i) => i.boqItemId === itemId)
    const c = columns.findIndex((a) => a.id === activityId)
    const next = rows[r + dy]
    const nextCol = columns[c + dx]
    if (next && nextCol) focusCell(next.boqItemId, nextCol.id)
  }

  const commit = async (item: CoverageItem, activity: Activity, raw: string) => {
    const value = raw.trim()
    setEditing(null)
    if (!value) return
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) {
      toast.error('Enter a positive number')
      return
    }
    if (mode === 'amount' && !hasMoneyPrecision(value)) {
      toast.error(MONEY_PRECISION_MESSAGE)
      return
    }
    const figure = mode === 'amount' ? { amount: toMoneyNumber(value), basis: 'amount' as const } : { quantity: numeric, basis: 'quantity' as const }
    const existing = cellByPair.get(`${item.boqItemId}:${activity.id}`)
    if (existing) {
      if (existing.status !== 'draft') {
        toast.error('Only a draft can be edited; reject it to change an approved row')
        return
      }
      await updateAllocation.mutateAsync({ allocationId: existing.id, data: figure })
    } else {
      await createAllocation.mutateAsync({ boqItemId: item.boqItemId, activityId: activity.id, ...figure })
    }
    focusCell(item.boqItemId, activity.id)
  }

  const acceptSuggestion = async (item: CoverageItem, suggestion: MappingSuggestion) => {
    const remaining = remainingOf(item)
    if (remaining <= 0) {
      toast.error('Nothing left to allocate on this row')
      return
    }
    await createAllocation.mutateAsync({
      boqItemId: item.boqItemId,
      activityId: suggestion.activityId,
      ...(mode === 'amount' ? { amount: remaining, basis: 'amount' } : { quantity: remaining, basis: 'quantity' }),
      suggestedBy: suggestion.suggestedBy,
      confidence: suggestion.confidence,
    })
  }

  const bulk = async (strategy: 'evenly' | 'duration' | 'remaining') => {
    const items = groups.flatMap((g) => g.items).filter((i) => selectedItems.has(i.boqItemId) && i.mappingRule !== 'not_applicable')
    const targets = columns.filter((a) => selectedActivities.has(a.id))
    if (items.length === 0 || targets.length === 0) return
    const payloads: AllocationDraftPayload[] = []
    for (const item of items) {
      const open = targets.filter((a) => !cellByPair.has(`${item.boqItemId}:${a.id}`))
      const remaining = remainingOf(item)
      if (open.length === 0 || remaining <= 0) continue
      const chosen = strategy === 'remaining' ? [open[0]] : open
      const weights = strategy === 'duration' ? chosen.map(durationDays) : chosen.map(() => 1)
      const shares = split(remaining, weights)
      chosen.forEach((activity, index) => {
        if (shares[index] <= 0) return
        payloads.push({
          boqItemId: item.boqItemId,
          activityId: activity.id,
          ...(mode === 'amount'
            ? { amount: shares[index], basis: 'amount' }
            : { quantity: Math.round(shares[index] * 1000) / 1000, basis: 'quantity' }),
        })
      })
    }
    if (payloads.length === 0) {
      toast.error('Every selected pair is already allocated or the rows are full')
      return
    }
    await bulkCreate.mutateAsync(payloads)
    setSelectedItems(new Set())
    setSelectedActivities(new Set())
  }

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  const armed = selectedItems.size > 0 && selectedActivities.size > 0 && canCreate

  if (columns.length === 0) {
    return (
      <div className='p-6 text-sm text-muted-foreground' data-testid='uat-mapping-matrix'>
        Create or import schedule activities before mapping BOQ rows to them.
      </div>
    )
  }
  if (coverage.items.length === 0) {
    return (
      <div className='p-6 text-sm text-muted-foreground' data-testid='uat-mapping-matrix'>
        Upload or enter BOQ rows before mapping them.
      </div>
    )
  }

  return (
    <div data-testid='uat-mapping-matrix'>
      <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs'>
        <span className='text-muted-foreground'>
          {selectedItems.size} row{selectedItems.size === 1 ? '' : 's'} × {selectedActivities.size} activit
          {selectedActivities.size === 1 ? 'y' : 'ies'} selected
        </span>
        <div className='ml-auto flex gap-1'>
          <Button size='sm' variant='outline' disabled={!armed || bulkCreate.isPending} onClick={() => void bulk('evenly')} data-testid='uat-mapping-bulk-evenly'>
            Allocate evenly
          </Button>
          <Button size='sm' variant='outline' disabled={!armed || bulkCreate.isPending} onClick={() => void bulk('duration')} data-testid='uat-mapping-bulk-duration'>
            By duration
          </Button>
          <Button size='sm' variant='outline' disabled={!armed || bulkCreate.isPending} onClick={() => void bulk('remaining')} data-testid='uat-mapping-bulk-remaining'>
            By remaining capacity
          </Button>
        </div>
      </div>

      <div className='overflow-auto'>
        <table className='w-max min-w-full border-separate border-spacing-0 text-xs'>
          <thead>
            <tr>
              <th className='sticky left-0 z-20 min-w-64 border-b border-r bg-background px-2 py-2 text-left font-medium'>
                BOQ row
              </th>
              <th className='sticky left-64 z-20 border-b border-r bg-background px-2 py-2 text-right font-medium'>
                Open ({mode === 'amount' ? currency : 'qty'})
              </th>
              {columns.map((activity) => (
                <th
                  key={activity.id}
                  className='min-w-32 max-w-40 border-b border-r bg-background px-2 py-1 text-left align-bottom font-medium'
                  title={`${activityLabel(activity)} · ${activity.name}${activity.wbsCode ? ` · WBS ${activity.wbsCode}` : ''}`}
                >
                  <div className='flex items-start gap-1'>
                    <Checkbox
                      checked={selectedActivities.has(activity.id)}
                      onCheckedChange={() => setSelectedActivities((s) => toggle(s, activity.id))}
                      aria-label={`Select ${activityLabel(activity)}`}
                      data-testid={`uat-mapping-col-${activityLabel(activity)}`}
                    />
                    <div className='min-w-0'>
                      <div className='truncate font-semibold'>{activityLabel(activity)}</div>
                      <div className='truncate font-normal text-muted-foreground'>{activity.name}</div>
                      {activity.wbsCode && (
                        <div className='truncate font-normal text-muted-foreground/70'>{activity.wbsCode}</div>
                      )}
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <GroupRows
                key={group.key}
                group={group}
                columns={columns}
                currency={currency}
                mode={mode}
                editing={editing}
                setEditing={setEditing}
                cellByPair={cellByPair}
                suggestionByPair={suggestionByPair}
                selectedItems={selectedItems}
                onToggleItem={(id) => setSelectedItems((s) => toggle(s, id))}
                onCommit={commit}
                onAccept={acceptSuggestion}
                onMove={moveFocus}
                registerCell={(key, el) => {
                  if (el) cellRefs.current.set(key, el)
                  else cellRefs.current.delete(key)
                }}
                remainingOf={remainingOf}
                onRule={(itemId, rule) => setRules.mutate({ rule, itemIds: [itemId] })}
                canCreate={canCreate}
                canUpdate={canUpdate}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type GroupRowsProps = {
  group: { key: string; label: string | null; items: CoverageItem[] }
  columns: Activity[]
  currency: string
  mode: CellMode
  editing: Editing | null
  setEditing: (next: Editing | null) => void
  cellByPair: Map<string, MappingAllocation>
  suggestionByPair: Map<string, MappingSuggestion>
  selectedItems: Set<string>
  onToggleItem: (id: string) => void
  onCommit: (item: CoverageItem, activity: Activity, raw: string) => Promise<void>
  onAccept: (item: CoverageItem, suggestion: MappingSuggestion) => Promise<void>
  onMove: (itemId: string, activityId: string, dx: number, dy: number) => void
  registerCell: (key: string, el: HTMLButtonElement | null) => void
  remainingOf: (item: CoverageItem) => number
  onRule: (itemId: string, rule: MappingRule) => void
  canCreate: boolean
  canUpdate: boolean
}

function GroupRows({
  group,
  columns,
  currency,
  mode,
  editing,
  setEditing,
  cellByPair,
  suggestionByPair,
  selectedItems,
  onToggleItem,
  onCommit,
  onAccept,
  onMove,
  registerCell,
  remainingOf,
  onRule,
  canCreate,
  canUpdate,
}: GroupRowsProps) {
  return (
    <>
      {group.label && (
        <tr>
          <td
            colSpan={columns.length + 2}
            className='sticky left-0 border-b bg-muted/60 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'
          >
            {group.label}
          </td>
        </tr>
      )}
      {group.items.map((item) => {
        const notApplicable = item.mappingRule === 'not_applicable'
        return (
          <tr key={item.boqItemId} data-testid={`uat-mapping-item-${item.code}`} className={cn(notApplicable && 'opacity-60')}>
            <td className='sticky left-0 z-10 min-w-64 border-b border-r bg-background px-2 py-1'>
              <div className='flex items-center gap-2'>
                <Checkbox
                  checked={selectedItems.has(item.boqItemId)}
                  onCheckedChange={() => onToggleItem(item.boqItemId)}
                  disabled={notApplicable}
                  aria-label={`Select ${item.code}`}
                  data-testid={`uat-mapping-row-select-${item.code}`}
                />
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-1'>
                    <span className='font-semibold'>{item.code}</span>
                    <StateBadge state={item.mappingState} />
                  </div>
                  <div className='truncate text-muted-foreground' title={item.description}>
                    {item.description}
                  </div>
                </div>
                {canUpdate ? (
                  <Select value={item.mappingRule} onValueChange={(rule) => onRule(item.boqItemId, rule as MappingRule)}>
                    <SelectTrigger className='h-6 w-20 px-1 text-[10px]' aria-label={`Mapping rule for ${item.code}`} data-testid={`uat-mapping-rule-${item.code}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ruleLabel) as MappingRule[]).map((rule) => (
                        <SelectItem key={rule} value={rule}>
                          {ruleLabel[rule]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant='outline' className='text-[10px]'>{ruleLabel[item.mappingRule]}</Badge>
                )}
              </div>
            </td>
            <td className='sticky left-64 z-10 border-b border-r bg-background px-2 py-1 text-right tabular-nums' data-testid={`uat-mapping-open-${item.code}`}>
              {notApplicable ? '—' : fmt(remainingOf(item), mode === 'amount' ? 2 : 3)}
              <div className='text-[10px] text-muted-foreground'>
                of {fmt(mode === 'amount' ? item.amount : item.quantity, mode === 'amount' ? 2 : 3)}
              </div>
            </td>
            {columns.map((activity) => {
              const key = `${item.boqItemId}:${activity.id}`
              const cell = cellByPair.get(key)
              const suggestion = !cell ? suggestionByPair.get(key) : undefined
              const isEditing = editing?.itemId === item.boqItemId && editing.activityId === activity.id
              const editable = !notApplicable && (cell ? cell.status === 'draft' && canUpdate : canCreate)
              return (
                <td key={activity.id} className='border-b border-r p-0.5 align-middle'>
                  {isEditing ? (
                    <input
                      autoFocus
                      type='number'
                      min='0'
                      step={mode === 'amount' ? '0.01' : '0.001'}
                      defaultValue={editing.value}
                      className='h-8 w-full rounded border border-primary bg-background px-1 text-right tabular-nums outline-none'
                      data-testid={`uat-mapping-cell-input-${item.code}-${activityLabel(activity)}`}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void onCommit(item, activity, event.currentTarget.value)
                        } else if (event.key === 'Escape') {
                          setEditing(null)
                        } else if (event.key === 'Tab') {
                          event.preventDefault()
                          void onCommit(item, activity, event.currentTarget.value).then(() =>
                            onMove(item.boqItemId, activity.id, event.shiftKey ? -1 : 1, 0)
                          )
                        }
                      }}
                      onBlur={(event) => void onCommit(item, activity, event.currentTarget.value)}
                    />
                  ) : (
                    <button
                      type='button'
                      ref={(el) => registerCell(key, el)}
                      disabled={notApplicable}
                      data-testid={`uat-mapping-cell-${item.code}-${activityLabel(activity)}`}
                      className={cn(
                        'flex h-8 w-full items-center justify-end rounded border px-1 text-right tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-primary/60',
                        cell
                          ? statusTone[cell.status]
                          : suggestion
                            ? 'border-dashed border-violet-400/70 bg-violet-50/60 text-violet-800 dark:bg-violet-950/30 dark:text-violet-200'
                            : 'border-transparent hover:border-muted-foreground/30',
                        !editable && !suggestion && 'cursor-default'
                      )}
                      title={
                        cell
                          ? `${cell.status} · ${fmt(cell.quantity, 3)} qty · ${currency} ${fmt(cell.amount, 2)} · ${fmt(cell.weight, 2)}%${cell.suggestedBy ? ` · ${cell.suggestedBy}` : ''}`
                          : suggestion
                            ? `Suggested by ${suggestion.suggestedBy} (${Math.round(suggestion.confidence * 100)}%): click to accept with the row's remaining value`
                            : editable
                              ? 'Type a figure to allocate'
                              : undefined
                      }
                      onClick={() => {
                        if (suggestion && canCreate) {
                          void onAccept(item, suggestion)
                          return
                        }
                        if (editable) {
                          setEditing({ itemId: item.boqItemId, activityId: activity.id, value: cell ? String(mode === 'amount' ? cell.amount : cell.quantity) : '' })
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowRight') onMove(item.boqItemId, activity.id, 1, 0)
                        else if (event.key === 'ArrowLeft') onMove(item.boqItemId, activity.id, -1, 0)
                        else if (event.key === 'ArrowDown') onMove(item.boqItemId, activity.id, 0, 1)
                        else if (event.key === 'ArrowUp') onMove(item.boqItemId, activity.id, 0, -1)
                        else if ((event.key === 'Enter' || event.key === 'F2') && editable) {
                          setEditing({ itemId: item.boqItemId, activityId: activity.id, value: cell ? String(mode === 'amount' ? cell.amount : cell.quantity) : '' })
                        } else if (/^[0-9.]$/.test(event.key) && editable) {
                          event.preventDefault()
                          setEditing({ itemId: item.boqItemId, activityId: activity.id, value: event.key })
                        } else return
                        event.preventDefault()
                      }}
                    >
                      {cell ? (
                        <span>{fmt(mode === 'amount' ? cell.amount : cell.quantity, mode === 'amount' ? 2 : 3)}</span>
                      ) : suggestion ? (
                        <span className='flex items-center gap-1 text-[10px]'>
                          <Sparkles className='h-3 w-3' />
                          {Math.round(suggestion.confidence * 100)}%
                        </span>
                      ) : (
                        <span className='text-muted-foreground/40'>·</span>
                      )}
                    </button>
                  )}
                </td>
              )
            })}
          </tr>
        )
      })}
    </>
  )
}

function StateBadge({ state }: { state: CoverageItem['mappingState'] }) {
  const tone: Record<CoverageItem['mappingState'], string> = {
    unmapped: 'text-muted-foreground',
    partial: 'text-amber-600',
    complete: 'text-emerald-600',
    over: 'text-destructive',
    not_applicable: 'text-muted-foreground',
  }
  const label: Record<CoverageItem['mappingState'], string> = {
    unmapped: 'unmapped',
    partial: 'partial',
    complete: 'complete',
    over: 'over',
    not_applicable: 'n/a',
  }
  return <span className={cn('text-[10px]', tone[state])}>{label[state]}</span>
}
