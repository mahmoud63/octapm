import { useDeferredValue, useMemo, useState } from 'react'
import { AlertTriangle, Flag, Loader2, Plus, Search } from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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
import {
  FORM_STATUSES,
  FORM_STATUS_LABEL,
  FORM_TYPES,
  FORM_TYPE_LABEL,
  formatFormDate,
  useFormInstances,
  type FormFilters,
  type FormStatus,
  type FormType,
} from '../hooks/use-forms'
import { FormStatusBadge, FormTypeBadge } from './form-badges'

const ANY = '__any'
const ACTIVE = '__active'

function SummaryCard({
  label,
  value,
  tone,
  icon,
  testId,
}: {
  label: string
  value: number
  tone?: 'warn' | 'bad'
  icon?: React.ReactNode
  testId?: string
}) {
  return (
    <div className='rounded border p-3' data-testid={testId}>
      <p className='flex items-center gap-1 text-xs text-muted-foreground'>
        {icon}
        {label}
      </p>
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

/** Inspections, ITPs, forms and talks on the project with filters and a summary. */
export function InstanceList({
  projectId,
  initialFilters,
  onOpen,
  onCreate,
}: {
  projectId: string
  initialFilters?: Partial<FormFilters>
  onOpen: (instanceId: string) => void
  onCreate: () => void
}) {
  const canCreate = useCanPerform('inspection', 'create')
  const [search, setSearch] = useState(initialFilters?.search ?? '')
  const deferredSearch = useDeferredValue(search)
  const [type, setType] = useState<FormType | ''>(initialFilters?.type ?? '')
  const [status, setStatus] = useState<string>(initialFilters?.status ?? '')
  const [mine, setMine] = useState(initialFilters?.ballInCourtUserId === 'me')
  const [overdue, setOverdue] = useState(Boolean(initialFilters?.overdue))

  const filters = useMemo<FormFilters>(
    () => ({
      search: deferredSearch.trim() || undefined,
      type,
      status: status || undefined,
      ballInCourtUserId: mine ? 'me' : null,
      overdue,
      activityId: initialFilters?.activityId ?? null,
    }),
    [deferredSearch, initialFilters?.activityId, mine, overdue, status, type]
  )
  const { data, isLoading, isFetching } = useFormInstances(projectId, filters)
  const items = data?.items ?? []
  const summary = data?.summary

  return (
    <div className='space-y-3' data-testid='uat-inspection-list'>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
        <SummaryCard label='Open' value={summary?.open ?? 0} />
        <SummaryCard
          label='Overdue'
          value={summary?.overdue ?? 0}
          tone='bad'
          testId='uat-inspection-summary-overdue'
        />
        <SummaryCard
          label='Awaiting close'
          value={summary?.awaitingClose ?? 0}
          tone='warn'
        />
        <SummaryCard label='Failed' value={summary?.failed ?? 0} tone='bad' />
        <SummaryCard
          label='Hold points open'
          value={summary?.holdPointsOpen ?? 0}
          tone='bad'
          icon={<Flag className='h-3 w-3' />}
          testId='uat-inspection-summary-holdpoints'
        />
      </div>

      <div className='flex flex-wrap items-end gap-2'>
        <div className='relative min-w-[200px] flex-1'>
          <Search className='pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='Ref, title, location…'
            className='pl-8'
            data-testid='uat-inspection-search'
          />
        </div>
        <Select
          value={type || ANY}
          onValueChange={(value) =>
            setType(value === ANY ? '' : (value as FormType))
          }
        >
          <SelectTrigger
            className='w-[150px]'
            data-testid='uat-inspection-type'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All types</SelectItem>
            {FORM_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {FORM_TYPE_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status || ACTIVE}
          onValueChange={(value) => setStatus(value === ACTIVE ? '' : value)}
        >
          <SelectTrigger
            className='w-[160px]'
            data-testid='uat-inspection-status'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ACTIVE}>All but void</SelectItem>
            {FORM_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {FORM_STATUS_LABEL[value as FormStatus]}
              </SelectItem>
            ))}
            <SelectItem value='all'>Everything</SelectItem>
          </SelectContent>
        </Select>
        <label className='flex h-9 items-center gap-2 text-sm'>
          <Switch
            checked={mine}
            onCheckedChange={setMine}
            data-testid='uat-inspection-mine'
          />
          Waiting on me
        </label>
        <label className='flex h-9 items-center gap-2 text-sm'>
          <Switch
            checked={overdue}
            onCheckedChange={setOverdue}
            data-testid='uat-inspection-overdue'
          />
          Overdue
        </label>
        {canCreate && (
          <Button
            size='sm'
            className='ml-auto'
            onClick={onCreate}
            data-testid='uat-inspection-new'
          >
            <Plus className='mr-2 h-4 w-4' /> Schedule
          </Button>
        )}
      </div>

      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        {isFetching && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
        <span>
          {data ? `${items.length} item${items.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      {isLoading ? (
        <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>
          {status || search || type || mine || overdue
            ? 'Nothing matches these filters.'
            : 'Nothing scheduled yet. Schedule an inspection from a template.'}
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-24'>Ref</TableHead>
                <TableHead>Inspection</TableHead>
                <TableHead className='hidden md:table-cell'>Where</TableHead>
                <TableHead className='hidden lg:table-cell'>Who</TableHead>
                <TableHead className='w-32'>When</TableHead>
                <TableHead className='hidden w-28 sm:table-cell'>
                  Progress
                </TableHead>
                <TableHead className='w-40'>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.id}
                  className='cursor-pointer'
                  onClick={() => onOpen(item.id)}
                  data-testid='uat-inspection-row'
                >
                  <TableCell className='font-mono text-xs'>
                    {item.ref}
                  </TableCell>
                  <TableCell>
                    <div className='flex flex-wrap items-center gap-1.5'>
                      <span className='font-medium'>{item.title}</span>
                      <FormTypeBadge type={item.type} />
                      {item.type === 'itp' &&
                        (item.summary?.holdPointsOpen ?? 0) > 0 &&
                        item.status !== 'void' && (
                          <span className='inline-flex items-center gap-1 text-xs text-destructive'>
                            <Flag className='h-3 w-3' />{' '}
                            {item.summary!.holdPointsOpen} hold
                          </span>
                        )}
                    </div>
                    <p className='text-xs text-muted-foreground'>
                      {item.template?.name}
                    </p>
                  </TableCell>
                  <TableCell className='hidden text-sm md:table-cell'>
                    {[item.activity?.name, item.location?.name]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </TableCell>
                  <TableCell className='hidden text-sm lg:table-cell'>
                    {item.assigneeCompany?.name ??
                      item.assigneeUser?.name ??
                      item.inspectorUser?.name ??
                      '—'}
                    {item.ballInCourtUser && (
                      <span className='block text-xs text-muted-foreground'>
                        waiting on {item.ballInCourtUser.name}
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-sm tabular-nums',
                      item.isOverdue && 'text-destructive'
                    )}
                  >
                    <span className='flex items-center gap-1'>
                      {item.isOverdue && <AlertTriangle className='h-3 w-3' />}
                      {formatFormDate(item.scheduledFor ?? item.dueDate)}
                    </span>
                  </TableCell>
                  <TableCell className='hidden sm:table-cell'>
                    {item.summary ? (
                      <div className='space-y-0.5'>
                        <div className='h-1.5 w-full overflow-hidden rounded bg-muted'>
                          <div
                            className={cn(
                              'h-full rounded',
                              item.summary.deficient
                                ? 'bg-destructive'
                                : 'bg-primary'
                            )}
                            style={{
                              width: `${(item.summary.answered / Math.max(1, item.summary.total)) * 100}%`,
                            }}
                          />
                        </div>
                        <p className='text-xs text-muted-foreground'>
                          {item.summary.answered}/{item.summary.total}
                        </p>
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <FormStatusBadge
                      status={item.status}
                      outcome={item.outcome}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
