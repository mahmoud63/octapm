import { useDeferredValue, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Download,
  Loader2,
  Plus,
  Search,
  Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CompanyPicker } from '@/components/user-picker'
import { LocationPicker } from '@/features/locations/components/location-picker'
import {
  PUNCH_PRIORITIES,
  PUNCH_STATUSES,
  STATUS_LABEL,
  downloadPunchExport,
  formatPunchDate,
  usePunchItems,
  type PunchFilters,
  type PunchGroupBy,
  type PunchItem,
  type PunchPriority,
} from '../hooks/use-punch'
import { PunchPriorityBadge, PunchStatusBadge } from './punch-badges'

const ANY = '__any'
const ACTIVE = '__active'

type Group = { key: string; label: string; items: PunchItem[] }

const groupItems = (items: PunchItem[], groupBy: PunchGroupBy): Group[] => {
  if (groupBy === 'none') return [{ key: 'all', label: '', items }]
  const map = new Map<string, Group>()
  for (const item of items) {
    const label =
      groupBy === 'company'
        ? (item.assigneeCompany?.name ?? 'Unassigned')
        : (item.location?.name ?? item.locationText ?? 'No location')
    const key = `${groupBy}:${label}`
    const group = map.get(key) ?? { key, label, items: [] }
    group.items.push(item)
    map.set(key, group)
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
}

function SummaryCard({
  label,
  value,
  tone,
  testId,
}: {
  label: string
  value: number
  tone?: 'warn' | 'bad'
  testId?: string
}) {
  return (
    <div className='rounded border p-3' data-testid={testId}>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p
        className={cn(
          'text-2xl font-bold tabular-nums',
          tone === 'bad' && value > 0 && 'text-destructive',
          tone === 'warn' && value > 0 && 'text-amber-600 dark:text-amber-400'
        )}
      >
        {value}
      </p>
    </div>
  )
}

/**
 * The punch list: filters, a summary, and a table that can be grouped by
 * company (one section per subcontractor) or location. Rows open the item;
 * checkboxes select items to send.
 */
export function PunchList({
  projectId,
  initialFilters,
  onOpenItem,
  onCreate,
  onDistribute,
}: {
  projectId: string
  initialFilters?: Partial<PunchFilters>
  onOpenItem: (itemId: string) => void
  onCreate: () => void
  onDistribute: (input: { itemIds: string[]; companyId: string | null }) => void
}) {
  const canCreate = useCanPerform('punch', 'create')
  const canExport = useCanPerform('punch', 'export')
  const canDistribute = useCanPerform('punch', 'submit', 'punch.distribute')

  const [search, setSearch] = useState(initialFilters?.search ?? '')
  const deferredSearch = useDeferredValue(search)
  const [status, setStatus] = useState<string>(initialFilters?.status ?? '')
  const [companyId, setCompanyId] = useState<string | null>(
    initialFilters?.assigneeCompanyId ?? null
  )
  const [locationId, setLocationId] = useState<string | null>(
    initialFilters?.locationId ?? null
  )
  const [priority, setPriority] = useState<PunchPriority | ''>(
    initialFilters?.priority ?? ''
  )
  const [mine, setMine] = useState(initialFilters?.ballInCourtUserId === 'me')
  const [overdue, setOverdue] = useState(Boolean(initialFilters?.overdue))
  const [groupBy, setGroupBy] = useState<PunchGroupBy>('company')
  const [selected, setSelected] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)

  const filters = useMemo<PunchFilters>(
    () => ({
      search: deferredSearch.trim() || undefined,
      status: status || undefined,
      assigneeCompanyId: companyId,
      locationId,
      priority: priority || undefined,
      ballInCourtUserId: mine ? 'me' : null,
      overdue,
      sheetId: initialFilters?.sheetId ?? null,
    }),
    [
      companyId,
      deferredSearch,
      initialFilters?.sheetId,
      locationId,
      mine,
      overdue,
      priority,
      status,
    ]
  )
  const { data, isLoading, isFetching } = usePunchItems(projectId, filters)
  const items = useMemo(() => data?.items ?? [], [data])
  const summary = data?.summary
  const groups = useMemo(() => groupItems(items, groupBy), [groupBy, items])
  const selectedSet = new Set(selected)
  const visibleSelected = items.filter((item) => selectedSet.has(item.id))
  const allSelected =
    items.length > 0 && visibleSelected.length === items.length

  const runExport = async (
    format: 'pdf' | 'csv',
    options: { groupBy?: PunchGroupBy; includePhotos?: boolean } = {}
  ) => {
    setExporting(true)
    try {
      const fileName = await downloadPunchExport(projectId, format, {
        ...filters,
        groupBy: options.groupBy ?? (groupBy === 'none' ? 'none' : groupBy),
        includePhotos: options.includePhotos,
      })
      toast.success(`Downloaded ${fileName}`)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className='space-y-3' data-testid='uat-punch-list'>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
        <SummaryCard
          label='Items'
          value={summary?.total ?? 0}
          testId='uat-punch-summary-total'
        />
        <SummaryCard label='Open' value={summary?.open ?? 0} />
        <SummaryCard
          label='Ready for review'
          value={summary?.byStatus.ready_for_review ?? 0}
          tone='warn'
        />
        <SummaryCard
          label='Overdue'
          value={summary?.overdue ?? 0}
          tone='bad'
          testId='uat-punch-summary-overdue'
        />
        <SummaryCard
          label='In dispute'
          value={summary?.byStatus.in_dispute ?? 0}
          tone='bad'
        />
      </div>
      {summary && summary.byCompany.length > 0 && (
        <div className='flex flex-wrap gap-1.5 text-xs'>
          {summary.byCompany.slice(0, 8).map((entry) => (
            <span
              key={entry.company}
              className='rounded-full border px-2 py-0.5 text-muted-foreground'
            >
              {entry.company}: {entry.open} open
              {entry.overdue ? ` · ${entry.overdue} late` : ''}
            </span>
          ))}
        </div>
      )}

      <div className='flex flex-wrap items-end gap-2'>
        <div className='relative min-w-[200px] flex-1'>
          <Search className='pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='Ref, title, location…'
            className='pl-8'
            data-testid='uat-punch-search'
          />
        </div>
        <Select
          value={status || ACTIVE}
          onValueChange={(value) => setStatus(value === ACTIVE ? '' : value)}
        >
          <SelectTrigger className='w-[170px]' data-testid='uat-punch-status'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ACTIVE}>All but void</SelectItem>
            {PUNCH_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {STATUS_LABEL[value]}
              </SelectItem>
            ))}
            <SelectItem value='all'>Everything</SelectItem>
          </SelectContent>
        </Select>
        <div className='w-[200px]'>
          <CompanyPicker
            projectId={projectId}
            value={companyId}
            onChange={setCompanyId}
            placeholder='Any company'
            testId='uat-punch-company-filter'
          />
        </div>
        <div className='w-[200px]'>
          <LocationPicker
            projectId={projectId}
            value={locationId}
            onChange={setLocationId}
            allowRoot
            rootLabel='Anywhere'
            placeholder='Location'
          />
        </div>
        <Select
          value={priority || ANY}
          onValueChange={(value) =>
            setPriority(value === ANY ? '' : (value as PunchPriority))
          }
        >
          <SelectTrigger className='w-[130px]'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any priority</SelectItem>
            {PUNCH_PRIORITIES.map((value) => (
              <SelectItem key={value} value={value}>
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className='flex h-9 items-center gap-2 text-sm'>
          <Switch
            checked={mine}
            onCheckedChange={setMine}
            data-testid='uat-punch-mine'
          />
          Waiting on me
        </label>
        <label className='flex h-9 items-center gap-2 text-sm'>
          <Switch
            checked={overdue}
            onCheckedChange={setOverdue}
            data-testid='uat-punch-overdue'
          />
          Overdue
        </label>
        <Select
          value={groupBy}
          onValueChange={(value) => setGroupBy(value as PunchGroupBy)}
        >
          <SelectTrigger className='w-[170px]' data-testid='uat-punch-groupby'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='company'>Group by company</SelectItem>
            <SelectItem value='location'>Group by location</SelectItem>
            <SelectItem value='none'>No grouping</SelectItem>
          </SelectContent>
        </Select>
        <div className='ml-auto flex flex-wrap gap-2'>
          {canDistribute && (
            <Button
              size='sm'
              variant='outline'
              onClick={() =>
                onDistribute({
                  itemIds: visibleSelected.map((i) => i.id),
                  companyId,
                })
              }
              data-testid='uat-punch-distribute'
            >
              <Send className='mr-2 h-4 w-4' />
              {visibleSelected.length
                ? `Send ${visibleSelected.length}`
                : 'Send list'}
            </Button>
          )}
          {canExport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={exporting}
                  data-testid='uat-punch-export'
                >
                  {exporting ? (
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  ) : (
                    <Download className='mr-2 h-4 w-4' />
                  )}
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuLabel>Uses the current filters</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => runExport('pdf', { groupBy: 'company' })}
                >
                  PDF, one section per company
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => runExport('pdf', { groupBy: 'location' })}
                >
                  PDF, by location
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    runExport('pdf', {
                      groupBy: 'company',
                      includePhotos: true,
                    })
                  }
                >
                  PDF with photos
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => runExport('csv')}>
                  CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canCreate && (
            <Button size='sm' onClick={onCreate} data-testid='uat-punch-new'>
              <Plus className='mr-2 h-4 w-4' /> New item
            </Button>
          )}
        </div>
      </div>

      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        {isFetching && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
        <span>
          {data ? `${items.length} item${items.length === 1 ? '' : 's'}` : ''}
          {visibleSelected.length
            ? ` · ${visibleSelected.length} selected`
            : ''}
        </span>
      </div>

      {isLoading ? (
        <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' /> Loading punch list…
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>
          {status || search || companyId || locationId || mine || overdue
            ? 'Nothing matches these filters.'
            : 'No punch items yet. Add them from a walk-through, or drop a pin on a drawing.'}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-8'>
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelected(
                        checked === true ? items.map((i) => i.id) : []
                      )
                    }
                    aria-label='Select all'
                  />
                </TableHead>
                <TableHead className='w-20'>Ref</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className='hidden md:table-cell'>Location</TableHead>
                <TableHead className='hidden lg:table-cell'>
                  Responsible
                </TableHead>
                <TableHead className='hidden lg:table-cell'>
                  Waiting on
                </TableHead>
                <TableHead className='w-28'>Due</TableHead>
                <TableHead className='w-32'>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <GroupRows
                  key={group.key}
                  group={group}
                  showHeader={groupBy !== 'none'}
                  selectedSet={selectedSet}
                  onToggle={(id, checked) =>
                    setSelected((current) =>
                      checked
                        ? [...new Set([...current, id])]
                        : current.filter((x) => x !== id)
                    )
                  }
                  onOpen={onOpenItem}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function GroupRows({
  group,
  showHeader,
  selectedSet,
  onToggle,
  onOpen,
}: {
  group: Group
  showHeader: boolean
  selectedSet: Set<string>
  onToggle: (id: string, checked: boolean) => void
  onOpen: (id: string) => void
}) {
  const open = group.items.filter(
    (item) => item.status !== 'closed' && item.status !== 'void'
  ).length
  return (
    <>
      {showHeader && (
        <TableRow className='bg-muted/40 hover:bg-muted/40'>
          <TableCell colSpan={8} className='py-1.5 text-xs font-semibold'>
            {group.label}
            <span className='ml-2 font-normal text-muted-foreground'>
              {open} open of {group.items.length}
            </span>
          </TableCell>
        </TableRow>
      )}
      {group.items.map((item) => (
        <TableRow
          key={item.id}
          className='cursor-pointer'
          onClick={() => onOpen(item.id)}
          data-testid='uat-punch-row'
        >
          <TableCell onClick={(event) => event.stopPropagation()}>
            <Checkbox
              checked={selectedSet.has(item.id)}
              onCheckedChange={(checked) => onToggle(item.id, checked === true)}
              aria-label={`Select ${item.ref}`}
            />
          </TableCell>
          <TableCell className='font-mono text-xs'>{item.ref}</TableCell>
          <TableCell>
            <div className='flex flex-wrap items-center gap-1.5'>
              <span className='font-medium'>{item.title}</span>
              <PunchPriorityBadge priority={item.priority} />
            </div>
            <p className='text-xs text-muted-foreground'>
              {[item.trade, item.locationText].filter(Boolean).join(' · ')}
            </p>
          </TableCell>
          <TableCell className='hidden text-sm md:table-cell'>
            {item.location?.name ?? '—'}
          </TableCell>
          <TableCell className='hidden text-sm lg:table-cell'>
            {item.assigneeCompany?.name ?? '—'}
            {item.assigneeUser ? (
              <span className='block text-xs text-muted-foreground'>
                {item.assigneeUser.name}
              </span>
            ) : null}
          </TableCell>
          <TableCell className='hidden text-sm lg:table-cell'>
            {item.ballInCourtUser?.name ?? '—'}
          </TableCell>
          <TableCell
            className={cn(
              'text-sm tabular-nums',
              item.isOverdue && 'text-destructive'
            )}
          >
            <span className='flex items-center gap-1'>
              {item.isOverdue && <AlertTriangle className='h-3 w-3' />}
              {formatPunchDate(item.dueDate)}
            </span>
          </TableCell>
          <TableCell>
            <PunchStatusBadge status={item.status} />
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}
