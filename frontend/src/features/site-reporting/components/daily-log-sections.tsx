import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import {
  AlertTriangle,
  Check,
  CloudRain,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { isQueued, newClientRequestId } from '@/lib/offline/outbox'
import { sendOrQueue } from '@/lib/offline/queue-request'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { Equipment } from '@/features/equipment/data/schema'
import type { LocationRecord } from '@/features/locations/hooks/use-locations'
import type { ProjectParty } from '@/features/projects/data/schema'
import {
  allocatedItemsOf,
  allocatedItemsResponseSchema,
  type AllocatedItem,
  type ScheduleActivity,
} from '@/features/schedule/data/schema'
import {
  DELAY_TYPES,
  NOTE_KINDS,
  SECTION_LABEL,
  useAddDailyLogEntry,
  useDeleteDailyLogEntry,
  useLogWeatherDelay,
  useReviewDailyLogEntry,
  useUpdateDailyLogEntry,
  type DailyLog,
  type DailyLogEntry,
  type DailyLogEntryInput,
  type DailyLogSection,
} from '../hooks/use-daily-log'

const NONE = '__none'

type FieldType =
  | 'text'
  | 'number'
  | 'time'
  | 'textarea'
  | 'activity'
  | 'location'
  | 'equipment'
  | 'company'
  | 'select'
type FieldDef = {
  key: string
  label: string
  type: FieldType
  required?: boolean
  options?: readonly string[]
  defaultValue?: string
  step?: string
  min?: number
  max?: number
  wide?: boolean
}

const SECTION_FIELDS: Record<DailyLogSection, FieldDef[]> = {
  manpower: [
    { key: 'companyName', label: 'Company', type: 'company' },
    { key: 'trade', label: 'Trade', type: 'text', required: true },
    {
      key: 'workers',
      label: 'Workers',
      type: 'number',
      min: 0,
      defaultValue: '',
    },
    {
      key: 'hours',
      label: 'Hours each',
      type: 'number',
      min: 0,
      max: 24,
      step: '0.5',
      defaultValue: '8',
    },
    { key: 'activityId', label: 'Activity', type: 'activity' },
    { key: 'locationId', label: 'Location', type: 'location' },
    { key: 'notes', label: 'Notes', type: 'text', wide: true },
  ],
  equipment: [
    { key: 'equipmentId', label: 'From register', type: 'equipment' },
    { key: 'name', label: 'Equipment', type: 'text' },
    { key: 'count', label: 'No.', type: 'number', min: 1, defaultValue: '1' },
    {
      key: 'hoursOperated',
      label: 'Operated h',
      type: 'number',
      min: 0,
      max: 24,
      step: '0.5',
      defaultValue: '',
    },
    {
      key: 'hoursIdle',
      label: 'Idle h',
      type: 'number',
      min: 0,
      max: 24,
      step: '0.5',
      defaultValue: '0',
    },
    { key: 'activityId', label: 'Activity', type: 'activity' },
    { key: 'locationId', label: 'Location', type: 'location' },
    { key: 'notes', label: 'Notes', type: 'text', wide: true },
  ],
  deliveries: [
    { key: 'deliveredAt', label: 'Time', type: 'time' },
    { key: 'supplierName', label: 'Supplier', type: 'text' },
    {
      key: 'description',
      label: 'What arrived',
      type: 'text',
      required: true,
      wide: true,
    },
    { key: 'quantity', label: 'Qty', type: 'number', min: 0, step: '0.01' },
    { key: 'unit', label: 'Unit', type: 'text' },
    { key: 'poRef', label: 'PO ref', type: 'text' },
    { key: 'receivedBy', label: 'Received by', type: 'text' },
    { key: 'activityId', label: 'Activity', type: 'activity' },
    { key: 'notes', label: 'Notes', type: 'text', wide: true },
  ],
  visitors: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'company', label: 'Company', type: 'text' },
    { key: 'purpose', label: 'Purpose', type: 'text', wide: true },
    { key: 'arrivedAt', label: 'In', type: 'time' },
    { key: 'leftAt', label: 'Out', type: 'time' },
    { key: 'notes', label: 'Notes', type: 'text', wide: true },
  ],
  delays: [
    {
      key: 'type',
      label: 'Type',
      type: 'select',
      options: DELAY_TYPES,
      defaultValue: 'other',
    },
    {
      key: 'description',
      label: 'What happened',
      type: 'text',
      required: true,
      wide: true,
    },
    {
      key: 'hoursLost',
      label: 'Hours lost',
      type: 'number',
      min: 0,
      max: 24,
      step: '0.5',
      defaultValue: '',
    },
    { key: 'activityId', label: 'Activity', type: 'activity' },
    { key: 'locationId', label: 'Location', type: 'location' },
    { key: 'notes', label: 'Notes', type: 'text', wide: true },
  ],
  notes: [
    {
      key: 'kind',
      label: 'Kind',
      type: 'select',
      options: NOTE_KINDS,
      defaultValue: 'general',
    },
    {
      key: 'text',
      label: 'Note',
      type: 'textarea',
      required: true,
      wide: true,
    },
    { key: 'activityId', label: 'Activity', type: 'activity' },
    { key: 'locationId', label: 'Location', type: 'location' },
  ],
}

const timeOf = (value?: string | null) => (value ? value.slice(11, 16) : '')
const num = (value?: number | null, digits = 1) =>
  value === null || value === undefined
    ? '—'
    : String(Math.round(value * 10 ** digits) / 10 ** digits)
const activityLabel = (entry: DailyLogEntry) =>
  entry.activity
    ? `${entry.activity.code ? `${entry.activity.code} ` : ''}${entry.activity.name}`
    : ''

const SECTION_COLUMNS: Record<
  DailyLogSection,
  Array<{
    label: string
    render: (entry: DailyLogEntry) => ReactNode
    align?: 'right'
  }>
> = {
  manpower: [
    {
      label: 'Company',
      render: (e) => e.companyName || e.party?.companyName || '—',
    },
    { label: 'Trade', render: (e) => e.trade },
    { label: 'Workers', render: (e) => e.workers, align: 'right' },
    { label: 'Hrs each', render: (e) => num(e.hours), align: 'right' },
    { label: 'Man-hours', render: (e) => num(e.manHours), align: 'right' },
    { label: 'Activity', render: activityLabel },
  ],
  equipment: [
    { label: 'Equipment', render: (e) => e.name },
    { label: 'No.', render: (e) => e.count, align: 'right' },
    {
      label: 'Operated h',
      render: (e) => num(e.hoursOperated),
      align: 'right',
    },
    { label: 'Idle h', render: (e) => num(e.hoursIdle), align: 'right' },
    { label: 'Activity', render: activityLabel },
  ],
  deliveries: [
    { label: 'Time', render: (e) => timeOf(e.deliveredAt) },
    { label: 'Supplier', render: (e) => e.supplierName || '—' },
    { label: 'What arrived', render: (e) => e.description },
    {
      label: 'Qty',
      render: (e) =>
        e.quantity === null || e.quantity === undefined
          ? ''
          : `${num(e.quantity, 2)} ${e.unit ?? ''}`.trim(),
      align: 'right',
    },
    { label: 'Received by', render: (e) => e.receivedBy || '' },
  ],
  visitors: [
    { label: 'Name', render: (e) => e.name },
    { label: 'Company', render: (e) => e.company || '' },
    { label: 'Purpose', render: (e) => e.purpose || '' },
    { label: 'In', render: (e) => timeOf(e.arrivedAt) },
    { label: 'Out', render: (e) => timeOf(e.leftAt) },
  ],
  delays: [
    { label: 'Type', render: (e) => e.type },
    { label: 'What happened', render: (e) => e.description },
    { label: 'Hours lost', render: (e) => num(e.hoursLost), align: 'right' },
    { label: 'Activity', render: activityLabel },
  ],
  notes: [
    { label: 'Kind', render: (e) => e.kind },
    {
      label: 'Note',
      render: (e) => <span className='whitespace-pre-wrap'>{e.text}</span>,
    },
    { label: 'Activity', render: activityLabel },
  ],
}

const initialValues = (
  section: DailyLogSection,
  entry?: DailyLogEntry | null
) =>
  Object.fromEntries(
    SECTION_FIELDS[section].map((field) => {
      if (!entry) return [field.key, field.defaultValue ?? '']
      const raw = (entry as unknown as Record<string, unknown>)[field.key]
      if (field.type === 'time')
        return [field.key, timeOf(raw as string | null)]
      if (field.key === 'companyName')
        return [
          field.key,
          (entry.companyName ?? entry.party?.companyName ?? '') as string,
        ]
      return [field.key, raw === null || raw === undefined ? '' : String(raw)]
    })
  ) as Record<string, string>

export interface SectionContext {
  activities: ScheduleActivity[]
  locations: LocationRecord[]
  equipment: Equipment[]
  parties: ProjectParty[]
}

function EntryForm({
  section,
  context,
  initial,
  pending,
  onCancel,
  onSubmit,
}: {
  section: DailyLogSection
  context: SectionContext
  initial: Record<string, string>
  pending: boolean
  onCancel?: () => void
  onSubmit: (payload: DailyLogEntryInput) => Promise<void>
}) {
  const [values, setValues] = useState(initial)
  const set = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }))
  const companies = context.parties
    .map((party) => ({ id: party.companyId, name: party.company?.name ?? '' }))
    .filter((company) => company.name)

  const build = (): DailyLogEntryInput => {
    const payload: DailyLogEntryInput = {}
    for (const field of SECTION_FIELDS[section]) {
      const raw = values[field.key] ?? ''
      if (field.type === 'number')
        payload[field.key] = raw === '' ? null : Number(raw)
      else if (field.type === 'company') {
        const match = companies.find(
          (company) => company.name.toLowerCase() === raw.trim().toLowerCase()
        )
        payload.companyName = raw.trim() || null
        payload.companyId = match?.id ?? null
      } else payload[field.key] = raw === '' || raw === NONE ? null : raw
    }
    return payload
  }

  return (
    <form
      className='grid gap-2 rounded-md border bg-muted/20 p-2 sm:grid-cols-4'
      data-testid={`uat-dailylog-form-${section}`}
      onSubmit={async (event) => {
        event.preventDefault()
        await onSubmit(build())
      }}
    >
      {SECTION_FIELDS[section].map((field) => {
        const value = values[field.key] ?? ''
        const common = {
          id: `dl-${section}-${field.key}`,
          'aria-label': field.label,
        }
        let control: ReactNode
        if (field.type === 'select') {
          control = (
            <Select
              value={value || field.defaultValue || ''}
              onValueChange={(next) => set(field.key, next)}
            >
              <SelectTrigger className='h-8 text-xs' aria-label={field.label}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(field.options ?? []).map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        } else if (
          field.type === 'activity' ||
          field.type === 'location' ||
          field.type === 'equipment'
        ) {
          const options =
            field.type === 'activity'
              ? context.activities.map((activity) => ({
                  id: activity.id,
                  label:
                    `${activity.activityCode ?? activity.p6ActivityId ?? ''} ${activity.name}`.trim(),
                }))
              : field.type === 'location'
                ? context.locations.map((location) => ({
                    id: location.id,
                    label: location.fullName || location.name,
                  }))
                : context.equipment.map((item) => ({
                    id: item.id,
                    label: item.name,
                  }))
          control = (
            <Select
              value={value || NONE}
              onValueChange={(next) => {
                set(field.key, next === NONE ? '' : next)
                if (field.type === 'equipment' && next !== NONE) {
                  const picked = context.equipment.find(
                    (item) => item.id === next
                  )
                  if (picked && !values.name) set('name', picked.name)
                }
              }}
            >
              <SelectTrigger className='h-8 text-xs' aria-label={field.label}>
                <SelectValue placeholder={field.label} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  — {field.label.toLowerCase()} —
                </SelectItem>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        } else if (field.type === 'textarea') {
          control = (
            <Textarea
              {...common}
              rows={2}
              className='text-xs'
              value={value}
              required={field.required}
              onChange={(e) => set(field.key, e.target.value)}
              placeholder={field.label}
            />
          )
        } else if (field.type === 'company') {
          control = (
            <>
              <Input
                {...common}
                list={`dl-companies-${section}`}
                className='h-8 text-xs'
                value={value}
                onChange={(e) => set(field.key, e.target.value)}
                placeholder='Company'
              />
              <datalist id={`dl-companies-${section}`}>
                {companies.map((company) => (
                  <option key={company.id} value={company.name} />
                ))}
              </datalist>
            </>
          )
        } else {
          control = (
            <Input
              {...common}
              type={
                field.type === 'number'
                  ? 'number'
                  : field.type === 'time'
                    ? 'time'
                    : 'text'
              }
              className='h-8 text-xs'
              value={value}
              required={field.required}
              min={field.min}
              max={field.max}
              step={field.step ?? (field.type === 'number' ? '1' : undefined)}
              placeholder={field.label}
              onChange={(e) => set(field.key, e.target.value)}
            />
          )
        }
        return (
          <div
            key={field.key}
            className={cn('space-y-0.5', field.wide && 'sm:col-span-2')}
          >
            <label
              htmlFor={common.id}
              className='text-[10px] tracking-wide text-muted-foreground uppercase'
            >
              {field.label}
              {field.required ? ' *' : ''}
            </label>
            {control}
          </div>
        )
      })}
      <div className='flex items-end gap-2 sm:col-span-4'>
        <Button
          type='submit'
          size='sm'
          disabled={pending}
          data-testid={`uat-dailylog-save-${section}`}
        >
          {pending ? (
            <Loader2 className='mr-1 h-4 w-4 animate-spin' />
          ) : (
            <Check className='mr-1 h-4 w-4' />
          )}
          Save
        </Button>
        {onCancel && (
          <Button type='button' size='sm' variant='ghost' onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

function EntryStatus({ entry }: { entry: DailyLogEntry }) {
  if (entry.suggested) {
    return (
      <Badge
        variant='outline'
        className='border-amber-400 text-amber-700 dark:text-amber-300'
      >
        <CloudRain className='mr-1 h-3 w-3' /> Suggested
      </Badge>
    )
  }
  if (entry.status === 'submitted')
    return <Badge variant='outline'>Awaiting review</Badge>
  if (entry.status === 'rejected') {
    return (
      <Badge variant='destructive' title={entry.rejectionReason ?? undefined}>
        Returned
      </Badge>
    )
  }
  if (entry.status === 'draft') return <Badge variant='outline'>Draft</Badge>
  return null
}

/**
 * One section of the day: table of entries plus an inline add / edit form.
 * Collaborator (party) entries carry review controls for the site team.
 */
export function SectionCard({
  projectId,
  date,
  section,
  entries,
  context,
  canWrite,
  canReview,
  canUpdate,
  locked,
  ownsEntry,
}: {
  projectId: string
  date: string
  section: DailyLogSection
  entries: DailyLogEntry[]
  context: SectionContext
  canWrite: boolean
  canReview: boolean
  canUpdate: boolean
  locked: boolean
  ownsEntry: (entry: DailyLogEntry) => boolean
}) {
  const add = useAddDailyLogEntry(projectId)
  const update = useUpdateDailyLogEntry(projectId)
  const remove = useDeleteDailyLogEntry(projectId)
  const review = useReviewDailyLogEntry(projectId)
  const logWeather = useLogWeatherDelay(projectId)
  const [adding, setAdding] = useState(false)
  const [formNonce, setFormNonce] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const columns = SECTION_COLUMNS[section]
  const pending = add.isPending || update.isPending
  const awaiting = entries.filter(
    (entry) => entry.status === 'submitted' || entry.suggested
  ).length

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn()
      toast.success(success)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <section
      className='rounded-md border bg-card'
      data-testid={`uat-dailylog-section-${section}`}
    >
      <header className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
        <h4 className='text-sm font-semibold'>{SECTION_LABEL[section]}</h4>
        <span className='text-xs text-muted-foreground'>{entries.length}</span>
        {awaiting > 0 && (
          <Badge variant='outline' className='text-xs'>
            {awaiting} to review
          </Badge>
        )}
        {canWrite && !locked && (
          <Button
            size='sm'
            variant='outline'
            className='ml-auto h-7'
            data-testid={`uat-dailylog-add-${section}`}
            onClick={() => {
              setEditingId(null)
              setFormNonce((n) => n + 1)
              setAdding((v) => !v)
            }}
          >
            {adding ? (
              <X className='mr-1 h-3 w-3' />
            ) : (
              <Plus className='mr-1 h-3 w-3' />
            )}
            {adding ? 'Close' : 'Add'}
          </Button>
        )}
      </header>
      <div className='space-y-2 p-2'>
        {adding && !locked && (
          <EntryForm
            key={`add-${section}-${date}-${formNonce}`}
            section={section}
            context={context}
            initial={initialValues(section)}
            pending={pending}
            onCancel={() => setAdding(false)}
            onSubmit={async (payload) => {
              try {
                const result = await add.mutateAsync({ date, section, payload })
                if (isQueued(result))
                  toast.success(
                    'Saved to the outbox — it will sync when you are back online'
                  )
                else toast.success(`${SECTION_LABEL[section]} added`)
                setFormNonce((n) => n + 1)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          />
        )}
        {entries.length === 0 ? (
          <p className='px-1 py-2 text-xs text-muted-foreground'>
            Nothing logged.
          </p>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-xs'>
              <thead className='text-[10px] tracking-wide text-muted-foreground uppercase'>
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.label}
                      className={cn(
                        'px-1 py-1 text-left font-medium',
                        column.align === 'right' && 'text-right'
                      )}
                    >
                      {column.label}
                    </th>
                  ))}
                  <th className='px-1 py-1' />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const mine = ownsEntry(entry)
                  const editable = canWrite && !locked && mine
                  const reviewable =
                    canReview &&
                    !locked &&
                    (entry.status === 'submitted' || entry.suggested)
                  return (
                    <tr
                      key={entry.id}
                      className={cn(
                        'border-t align-top',
                        entry.status === 'rejected' && 'opacity-60',
                        entry.suggested && 'bg-amber-50/60 dark:bg-amber-950/20'
                      )}
                      data-testid={`uat-dailylog-entry-${section}`}
                    >
                      {editingId === entry.id ? (
                        <td colSpan={columns.length + 1} className='p-1'>
                          <EntryForm
                            key={`edit-${entry.id}-${entry.updatedAt}`}
                            section={section}
                            context={context}
                            initial={initialValues(section, entry)}
                            pending={pending}
                            onCancel={() => setEditingId(null)}
                            onSubmit={async (payload) => {
                              await run(
                                () =>
                                  update.mutateAsync({
                                    date,
                                    section,
                                    entryId: entry.id,
                                    payload,
                                  }),
                                'Entry updated'
                              )
                              setEditingId(null)
                            }}
                          />
                        </td>
                      ) : (
                        <>
                          {columns.map((column) => (
                            <td
                              key={column.label}
                              className={cn(
                                'px-1 py-1.5',
                                column.align === 'right' &&
                                  'text-right tabular-nums'
                              )}
                            >
                              {column.render(entry)}
                            </td>
                          ))}
                          <td className='px-1 py-1'>
                            <div className='flex flex-wrap items-center justify-end gap-1'>
                              <EntryStatus entry={entry} />
                              {entry.party && !entry.suggested && (
                                <span
                                  className='text-[10px] text-muted-foreground'
                                  title='Logged by a collaborator'
                                >
                                  {entry.party.companyName}
                                </span>
                              )}
                              {entry.notes &&
                                !columns.some(
                                  (column) => column.label === 'Notes'
                                ) && (
                                  <span
                                    className='max-w-40 truncate text-[10px] text-muted-foreground'
                                    title={entry.notes}
                                  >
                                    {entry.notes}
                                  </span>
                                )}
                              {section === 'delays' &&
                                entry.type === 'weather' &&
                                canUpdate &&
                                !locked &&
                                !entry.weatherDelayId &&
                                !entry.suggested && (
                                  <Button
                                    size='sm'
                                    variant='outline'
                                    className='h-6 px-2 text-[11px]'
                                    disabled={logWeather.isPending}
                                    onClick={() =>
                                      run(
                                        () =>
                                          logWeather.mutateAsync({
                                            date,
                                            entryId: entry.id,
                                          }),
                                        'Added to the weather delay register'
                                      )
                                    }
                                    data-testid='uat-dailylog-weather-register'
                                  >
                                    <AlertTriangle className='mr-1 h-3 w-3' />{' '}
                                    Register
                                  </Button>
                                )}
                              {section === 'delays' && entry.weatherDelayId && (
                                <Badge
                                  variant='secondary'
                                  className='text-[10px]'
                                >
                                  On register
                                </Badge>
                              )}
                              {reviewable && (
                                <>
                                  <Button
                                    size='sm'
                                    variant='outline'
                                    className='h-6 px-2 text-[11px]'
                                    disabled={review.isPending}
                                    onClick={() =>
                                      run(
                                        () =>
                                          review.mutateAsync({
                                            date,
                                            section,
                                            entryId: entry.id,
                                            decision: 'approve',
                                          }),
                                        entry.suggested
                                          ? 'Delay confirmed'
                                          : 'Entry accepted'
                                      )
                                    }
                                    data-testid={`uat-dailylog-accept-${section}`}
                                  >
                                    <Check className='mr-1 h-3 w-3' />{' '}
                                    {entry.suggested ? 'Confirm' : 'Accept'}
                                  </Button>
                                  <Button
                                    size='sm'
                                    variant='ghost'
                                    className='h-6 px-2 text-[11px]'
                                    disabled={review.isPending}
                                    onClick={() => {
                                      const reason =
                                        window.prompt(
                                          entry.suggested
                                            ? 'Why dismiss this suggestion?'
                                            : 'Why return this entry?'
                                        ) ?? ''
                                      if (!reason.trim()) return
                                      run(
                                        () =>
                                          review.mutateAsync({
                                            date,
                                            section,
                                            entryId: entry.id,
                                            decision: 'reject',
                                            reason,
                                          }),
                                        entry.suggested
                                          ? 'Suggestion dismissed'
                                          : 'Entry returned'
                                      )
                                    }}
                                  >
                                    <X className='mr-1 h-3 w-3' />{' '}
                                    {entry.suggested ? 'Dismiss' : 'Return'}
                                  </Button>
                                </>
                              )}
                              {(editable || (canReview && !locked)) && (
                                <Button
                                  size='icon'
                                  variant='ghost'
                                  className='h-6 w-6'
                                  aria-label='Edit'
                                  onClick={() => setEditingId(entry.id)}
                                >
                                  <Pencil className='h-3 w-3' />
                                </Button>
                              )}
                              {(editable || (canReview && !locked)) && (
                                <Button
                                  size='icon'
                                  variant='ghost'
                                  className='h-6 w-6'
                                  aria-label='Delete'
                                  disabled={remove.isPending}
                                  onClick={() => {
                                    if (!window.confirm('Remove this entry?'))
                                      return
                                    run(
                                      () =>
                                        remove.mutateAsync({
                                          date,
                                          section,
                                          entryId: entry.id,
                                        }),
                                      'Entry removed'
                                    )
                                  }}
                                >
                                  <Trash2 className='h-3 w-3' />
                                </Button>
                              )}
                            </div>
                            {entry.status === 'rejected' &&
                              entry.rejectionReason && (
                                <p className='mt-1 text-right text-[10px] text-destructive'>
                                  {entry.rejectionReason}
                                </p>
                              )}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

// ─── PC-6: the seventh section — quantities installed ───
// A daily log never changes official progress by itself (OCTAPM_PROGRESS_
// MEASUREMENT §3–§4): a quantity row here becomes a pending quantity
// progress entry when the day is submitted, and only a progress approver
// makes it official on the Progress tab. The row names the activity, a BOQ
// item from that activity's approved allocations (so the unit is the
// item's, shown and never typed), a quantity ≥ 0, a location and notes.
// The section's hooks are its own: the day's six older sections and their
// hooks (use-daily-log.ts) are unchanged.

export const QUANTITIES_SECTION = 'quantities' as const
export const QUANTITIES_SECTION_LABEL = 'Quantities installed'

export type DailyLogQuantityEntry = DailyLogEntry & {
  boqItemId?: string | null
  boqItem?: {
    id: string
    code?: string | null
    description?: string | null
    unit?: string | null
    unitCode?: string | null
  } | null
  allocationId?: string | null
  unitCode?: string | null
  withheld?: { reason: string } | boolean | null
  /** The server's withholding (utils/boq-figures): the keys omitted and why — a member who may not read the BOQ gets no quantity. */
  boqWithheld?: { keys?: string[]; reason: string } | null
}

const dailyLogKey = (projectId: string) => ['daily-log', projectId] as const
const dailyLogBase = (projectId: string) => `/projects/${projectId}/daily-logs`
const unwrapLog = (data: unknown) => (data as { data: DailyLog }).data

const invalidateDay = (
  qc: ReturnType<typeof useQueryClient>,
  projectId: string
) => {
  qc.invalidateQueries({ queryKey: dailyLogKey(projectId) })
  qc.invalidateQueries({ queryKey: ['audit-events', projectId] })
  // The Progress tab lists the pending entries a submitted day made.
  qc.invalidateQueries({ queryKey: ['progress-submissions', projectId] })
  qc.invalidateQueries({ queryKey: ['schedule', projectId] })
}

type QuantityEntryPayload = {
  activityId: string
  boqItemId: string
  allocationId?: string | null
  locationId?: string | null
  quantity: number
  unitCode: string
  notes?: string | null
  clientRequestId?: string
}

const useQuantitySectionMutations = (projectId: string, date: string) => {
  const qc = useQueryClient()
  const url = (entryId?: string) =>
    `${dailyLogBase(projectId)}/${date}/entries/${QUANTITIES_SECTION}${entryId ? `/${entryId}` : ''}`
  const add = useMutation({
    mutationFn: (payload: QuantityEntryPayload) => {
      const clientRequestId =
        payload.clientRequestId ?? newClientRequestId('daily-log-quantities')
      return sendOrQueue<DailyLog>({
        projectId,
        kind: 'daily_log',
        label: `Daily log ${date}: quantities installed`,
        method: 'POST',
        url: url(),
        body: { ...payload, clientRequestId },
        clientRequestId,
        parse: unwrapLog,
      })
    },
    onSuccess: () => invalidateDay(qc, projectId),
  })
  const update = useMutation({
    mutationFn: ({
      entryId,
      payload,
    }: {
      entryId: string
      payload: QuantityEntryPayload
    }) =>
      apiClient
        .patch(url(entryId), payload)
        .then((response) => response.data.data as DailyLog),
    onSuccess: () => invalidateDay(qc, projectId),
  })
  const remove = useMutation({
    mutationFn: (entryId: string) =>
      apiClient
        .delete(url(entryId))
        .then((response) => response.data.data as DailyLog),
    onSuccess: () => invalidateDay(qc, projectId),
  })
  const review = useMutation({
    mutationFn: ({
      entryId,
      decision,
      reason,
    }: {
      entryId: string
      decision: 'approve' | 'reject'
      reason?: string | null
    }) =>
      apiClient
        .post(`${url(entryId)}/review`, { decision, reason: reason ?? null })
        .then((response) => response.data.data as DailyLog),
    onSuccess: () => invalidateDay(qc, projectId),
  })
  return { add, update, remove, review }
}

type AllocatedItemsRead =
  | { state: 'ok'; items: AllocatedItem[] }
  | { state: 'not-on-server' | 'withheld' | 'error'; reason: string }

export const ALLOCATED_ITEMS_NOT_ON_SERVER =
  'Allocated BOQ items are not available on this server yet'

const readAllocatedItems = async (
  projectId: string,
  activityId: string
): Promise<AllocatedItemsRead> => {
  try {
    const response = await apiClient.get(
      `/projects/${projectId}/activities/${activityId}/allocated-items`
    )
    const parsed = allocatedItemsResponseSchema.safeParse(response.data?.data)
    if (!parsed.success)
      return {
        state: 'error',
        reason: 'The server answered in a shape this screen does not read',
      }
    const { items, reason } = allocatedItemsOf(parsed.data)
    if (!items.length && reason) return { state: 'withheld', reason }
    return { state: 'ok', items }
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response
      ?.status
    if (status === 404)
      return { state: 'not-on-server', reason: ALLOCATED_ITEMS_NOT_ON_SERVER }
    if (status === 403)
      return {
        state: 'withheld',
        reason: getServerErrorMessage(error, 'Withheld by the server'),
      }
    return {
      state: 'error',
      reason: getServerErrorMessage(
        error,
        'The allocated items could not be read'
      ),
    }
  }
}

const useAllocatedItems = (projectId: string, activityId: string) =>
  useQuery<AllocatedItemsRead>({
    queryKey: ['allocated-items', projectId, activityId],
    queryFn: () => readAllocatedItems(projectId, activityId),
    enabled: Boolean(projectId && activityId),
    retry: false,
  })

const itemIdOf = (item: AllocatedItem) =>
  item.boqItemId ?? item.boqItem?.id ?? item.id ?? ''
const itemUnitOf = (item: AllocatedItem) =>
  item.unitCode ??
  item.unit ??
  item.boqItem?.unitCode ??
  item.boqItem?.unit ??
  ''
const itemLabelOf = (item: AllocatedItem) =>
  [
    item.code ?? item.boqItem?.code,
    item.description ?? item.boqItem?.description,
  ]
    .filter(Boolean)
    .join(' · ') || itemIdOf(item)

const quantityEntryItemLabel = (entry: DailyLogQuantityEntry) =>
  [entry.boqItem?.code, entry.boqItem?.description]
    .filter(Boolean)
    .join(' · ') ||
  entry.boqItemId ||
  '—'

const quantityText = (value: number | null | undefined) =>
  value == null
    ? '—'
    : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 })

function QuantityEntryForm({
  projectId,
  context,
  initial,
  pending,
  onCancel,
  onSubmit,
}: {
  projectId: string
  context: SectionContext
  initial: Partial<DailyLogQuantityEntry> | null
  pending: boolean
  onCancel?: () => void
  onSubmit: (payload: QuantityEntryPayload) => Promise<void>
}) {
  const [activityId, setActivityId] = useState(initial?.activityId ?? '')
  const [boqItemId, setBoqItemId] = useState(initial?.boqItemId ?? '')
  const [locationId, setLocationId] = useState(initial?.locationId ?? '')
  const [quantity, setQuantity] = useState(
    initial?.quantity == null ? '' : String(initial.quantity)
  )
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const items = useAllocatedItems(projectId, activityId)
  const picked =
    items.data?.state === 'ok'
      ? items.data.items.find((item) => itemIdOf(item) === boqItemId)
      : undefined
  const unit =
    (picked ? itemUnitOf(picked) : '') ||
    initial?.unitCode ||
    initial?.boqItem?.unitCode ||
    initial?.boqItem?.unit ||
    ''
  const quantityNumber = quantity === '' ? NaN : Number(quantity)
  const canSave =
    Boolean(activityId && boqItemId && unit) &&
    Number.isFinite(quantityNumber) &&
    quantityNumber >= 0
  return (
    <form
      className='grid gap-2 rounded-md border bg-muted/20 p-2 sm:grid-cols-4'
      data-testid='uat-dailylog-form-quantities'
      onSubmit={async (event) => {
        event.preventDefault()
        if (!canSave) return
        await onSubmit({
          activityId,
          boqItemId,
          allocationId: picked?.allocationId ?? initial?.allocationId ?? null,
          locationId: locationId || null,
          quantity: quantityNumber,
          unitCode: unit,
          notes: notes.trim() || null,
        })
      }}
    >
      <div className='space-y-0.5 sm:col-span-2'>
        <label
          htmlFor='dl-quantities-activityId'
          className='text-[10px] tracking-wide text-muted-foreground uppercase'
        >
          Activity *
        </label>
        <Select
          value={activityId || NONE}
          onValueChange={(next) => {
            setActivityId(next === NONE ? '' : next)
            setBoqItemId('')
          }}
        >
          <SelectTrigger
            className='h-8 text-xs'
            aria-label='Activity'
            id='dl-quantities-activityId'
            data-testid='uat-dailylog-quantities-activity'
          >
            <SelectValue placeholder='Activity' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>— activity —</SelectItem>
            {context.activities.map((activity) => (
              <SelectItem key={activity.id} value={activity.id}>
                {`${activity.activityCode ?? activity.p6ActivityId ?? ''} ${activity.name}`.trim()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className='space-y-0.5 sm:col-span-2'>
        <label
          htmlFor='dl-quantities-boqItemId'
          className='text-[10px] tracking-wide text-muted-foreground uppercase'
        >
          BOQ item (approved allocations) *
        </label>
        {!activityId ? (
          <p className='text-xs text-muted-foreground'>
            Pick the activity first.
          </p>
        ) : items.isLoading ? (
          <p className='text-xs text-muted-foreground'>
            <Loader2 className='mr-1 inline h-3 w-3 animate-spin' />
            Reading the activity's allocations…
          </p>
        ) : items.data?.state !== 'ok' ? (
          // Not data: "—" with the server's reason, never an empty picker
          // that reads as "no allocations".
          <p
            className='text-xs text-muted-foreground'
            data-testid='uat-dailylog-quantities-items-unavailable'
            data-state={items.data?.state ?? 'error'}
          >
            — {items.data?.reason ?? 'The allocated items could not be read'}
          </p>
        ) : items.data.items.length === 0 ? (
          <p
            className='text-xs text-muted-foreground'
            data-testid='uat-dailylog-quantities-items-empty'
          >
            No approved BOQ allocation on this activity yet — map it first.
          </p>
        ) : (
          <Select
            value={boqItemId || NONE}
            onValueChange={(next) => setBoqItemId(next === NONE ? '' : next)}
          >
            <SelectTrigger
              className='h-8 text-xs'
              aria-label='BOQ item'
              id='dl-quantities-boqItemId'
              data-testid='uat-dailylog-quantities-item'
            >
              <SelectValue placeholder='BOQ item' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— BOQ item —</SelectItem>
              {items.data.items.map((item) => (
                <SelectItem key={itemIdOf(item)} value={itemIdOf(item)}>
                  {itemLabelOf(item)}
                  {itemUnitOf(item) ? ` (${itemUnitOf(item)})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className='space-y-0.5'>
        <label
          htmlFor='dl-quantities-quantity'
          className='text-[10px] tracking-wide text-muted-foreground uppercase'
        >
          Quantity *
        </label>
        <Input
          id='dl-quantities-quantity'
          aria-label='Quantity'
          type='number'
          min={0}
          step='0.001'
          required
          className='h-8 text-xs'
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder='0'
          data-testid='uat-dailylog-quantities-quantity'
        />
      </div>
      <div className='space-y-0.5'>
        <label
          htmlFor='dl-quantities-unit'
          className='text-[10px] tracking-wide text-muted-foreground uppercase'
        >
          Unit
        </label>
        {/* The BOQ item's unit: shown, never typed (an entry in another
            unit is refused by the server). */}
        <Input
          id='dl-quantities-unit'
          aria-label='Unit'
          readOnly
          disabled
          className='h-8 text-xs'
          value={unit}
          placeholder='from the item'
          title='The BOQ item’s unit — set by the bill, not typed here'
          data-testid='uat-dailylog-quantities-unit'
        />
      </div>
      <div className='space-y-0.5'>
        <label
          htmlFor='dl-quantities-locationId'
          className='text-[10px] tracking-wide text-muted-foreground uppercase'
        >
          Location
        </label>
        <Select
          value={locationId || NONE}
          onValueChange={(next) => setLocationId(next === NONE ? '' : next)}
        >
          <SelectTrigger
            className='h-8 text-xs'
            aria-label='Location'
            id='dl-quantities-locationId'
          >
            <SelectValue placeholder='Location' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>— location —</SelectItem>
            {context.locations.map((location) => (
              <SelectItem key={location.id} value={location.id}>
                {location.fullName || location.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className='space-y-0.5'>
        <label
          htmlFor='dl-quantities-notes'
          className='text-[10px] tracking-wide text-muted-foreground uppercase'
        >
          Notes
        </label>
        <Input
          id='dl-quantities-notes'
          aria-label='Notes'
          className='h-8 text-xs'
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder='Notes'
          data-testid='uat-dailylog-quantities-notes'
        />
      </div>
      <div className='flex items-end gap-2 sm:col-span-4'>
        <Button
          type='submit'
          size='sm'
          disabled={pending || !canSave}
          data-testid='uat-dailylog-save-quantities'
        >
          {pending ? (
            <Loader2 className='mr-1 h-4 w-4 animate-spin' />
          ) : (
            <Check className='mr-1 h-4 w-4' />
          )}
          Save
        </Button>
        {onCancel && (
          <Button type='button' size='sm' variant='ghost' onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

/**
 * Quantities installed today: the rows, an add / edit form, and a per-unit
 * tally of this log's rows — this day's rows only, grouped by unit and
 * never added across units, and never official progress (that is Σ approved
 * entries on the Progress tab).
 */
export function QuantitiesSectionCard({
  projectId,
  date,
  entries,
  context,
  canWrite,
  canReview,
  locked,
  ownsEntry,
}: {
  projectId: string
  date: string
  entries: DailyLogQuantityEntry[]
  context: SectionContext
  canWrite: boolean
  canReview: boolean
  locked: boolean
  ownsEntry: (entry: DailyLogEntry) => boolean
}) {
  const { add, update, remove, review } = useQuantitySectionMutations(
    projectId,
    date
  )
  const [adding, setAdding] = useState(false)
  const [formNonce, setFormNonce] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const pending = add.isPending || update.isPending
  const awaiting = entries.filter(
    (entry) => entry.status === 'submitted'
  ).length
  // No tally: every row stands on its own, in its item's unit. Adding rows
  // up (even per unit) would merge different BOQ items into one figure; the
  // one place a figure is summed is the server, per item, when an approver
  // accepts the entries, and the Progress tab draws that figure.

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn()
      toast.success(success)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <section
      className='rounded-md border bg-card'
      data-testid='uat-dailylog-section-quantities'
    >
      <header className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
        <h4 className='text-sm font-semibold'>{QUANTITIES_SECTION_LABEL}</h4>
        <span className='text-xs text-muted-foreground'>{entries.length}</span>
        {awaiting > 0 && (
          <Badge variant='outline' className='text-xs'>
            {awaiting} to review
          </Badge>
        )}
        {canWrite && !locked && (
          <Button
            size='sm'
            variant='outline'
            className='ml-auto h-7'
            data-testid='uat-dailylog-add-quantities'
            onClick={() => {
              setEditingId(null)
              setFormNonce((n) => n + 1)
              setAdding((v) => !v)
            }}
          >
            {adding ? (
              <X className='mr-1 h-3 w-3' />
            ) : (
              <Plus className='mr-1 h-3 w-3' />
            )}
            {adding ? 'Close' : 'Add'}
          </Button>
        )}
      </header>
      <div className='space-y-2 p-2'>
        <p className='px-1 text-[11px] text-muted-foreground'>
          A row here becomes a pending quantity progress entry when the day is
          submitted; a progress approver makes it official on the Progress tab.
          It never changes official progress by itself.
        </p>
        {adding && !locked && (
          <QuantityEntryForm
            key={`add-quantities-${date}-${formNonce}`}
            projectId={projectId}
            context={context}
            initial={null}
            pending={pending}
            onCancel={() => setAdding(false)}
            onSubmit={async (payload) => {
              try {
                const result = await add.mutateAsync(payload)
                if (isQueued(result))
                  toast.success(
                    'Saved to the outbox — it will sync when you are back online'
                  )
                else toast.success(`${QUANTITIES_SECTION_LABEL} added`)
                setFormNonce((n) => n + 1)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          />
        )}
        {entries.length === 0 ? (
          <p className='px-1 py-2 text-xs text-muted-foreground'>
            Nothing logged.
          </p>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-xs'>
              <thead className='text-[10px] tracking-wide text-muted-foreground uppercase'>
                <tr>
                  <th className='px-1 py-1 text-left font-medium'>Activity</th>
                  <th className='px-1 py-1 text-left font-medium'>BOQ item</th>
                  <th className='px-1 py-1 text-right font-medium'>Qty</th>
                  <th className='px-1 py-1 text-left font-medium'>Location</th>
                  <th className='px-1 py-1' />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const mine = ownsEntry(entry)
                  const editable = canWrite && !locked && mine
                  const reviewable =
                    canReview && !locked && entry.status === 'submitted'
                  const withheld =
                    entry.withheld && typeof entry.withheld === 'object'
                      ? entry.withheld.reason
                      : entry.withheld
                        ? 'Withheld by the server'
                        : entry.boqWithheld?.keys?.includes('quantity')
                          ? entry.boqWithheld.reason
                          : null
                  const unit =
                    entry.unitCode ??
                    entry.unit ??
                    entry.boqItem?.unitCode ??
                    ''
                  return (
                    <tr
                      key={entry.id}
                      className={cn(
                        'border-t align-top',
                        entry.status === 'rejected' && 'opacity-60'
                      )}
                      data-testid='uat-dailylog-entry-quantities'
                      data-entry-id={entry.id}
                    >
                      {editingId === entry.id ? (
                        <td colSpan={5} className='p-1'>
                          <QuantityEntryForm
                            key={`edit-${entry.id}-${entry.updatedAt}`}
                            projectId={projectId}
                            context={context}
                            initial={entry}
                            pending={pending}
                            onCancel={() => setEditingId(null)}
                            onSubmit={async (payload) => {
                              await run(
                                () =>
                                  update.mutateAsync({
                                    entryId: entry.id,
                                    payload,
                                  }),
                                'Entry updated'
                              )
                              setEditingId(null)
                            }}
                          />
                        </td>
                      ) : (
                        <>
                          <td className='px-1 py-1.5'>
                            {activityLabel(entry)}
                          </td>
                          <td className='px-1 py-1.5'>
                            {quantityEntryItemLabel(entry)}
                          </td>
                          <td className='px-1 py-1.5 text-right tabular-nums'>
                            {withheld || entry.quantity == null ? (
                              <span
                                className='text-muted-foreground'
                                title={withheld ?? undefined}
                                data-withheld-reason={withheld ?? ''}
                              >
                                — {withheld ?? ''}
                              </span>
                            ) : (
                              <span
                                data-entry-quantity={entry.quantity}
                                data-entry-unit={unit}
                              >
                                {quantityText(entry.quantity)} {unit}
                              </span>
                            )}
                          </td>
                          <td className='px-1 py-1.5'>
                            {entry.location?.name ?? ''}
                          </td>
                          <td className='px-1 py-1'>
                            <div className='flex flex-wrap items-center justify-end gap-1'>
                              <EntryStatus entry={entry} />
                              {entry.party && (
                                <span
                                  className='text-[10px] text-muted-foreground'
                                  title='Logged by a collaborator'
                                >
                                  {entry.party.companyName}
                                </span>
                              )}
                              {entry.notes && (
                                <span
                                  className='max-w-40 truncate text-[10px] text-muted-foreground'
                                  title={entry.notes}
                                >
                                  {entry.notes}
                                </span>
                              )}
                              {reviewable && (
                                <>
                                  <Button
                                    size='sm'
                                    variant='outline'
                                    className='h-6 px-2 text-[11px]'
                                    disabled={review.isPending}
                                    onClick={() =>
                                      run(
                                        () =>
                                          review.mutateAsync({
                                            entryId: entry.id,
                                            decision: 'approve',
                                          }),
                                        'Entry accepted'
                                      )
                                    }
                                    data-testid='uat-dailylog-accept-quantities'
                                  >
                                    <Check className='mr-1 h-3 w-3' /> Accept
                                  </Button>
                                  <Button
                                    size='sm'
                                    variant='ghost'
                                    className='h-6 px-2 text-[11px]'
                                    disabled={review.isPending}
                                    onClick={() => {
                                      const reason =
                                        window.prompt(
                                          'Why return this entry?'
                                        ) ?? ''
                                      if (!reason.trim()) return
                                      run(
                                        () =>
                                          review.mutateAsync({
                                            entryId: entry.id,
                                            decision: 'reject',
                                            reason,
                                          }),
                                        'Entry returned'
                                      )
                                    }}
                                  >
                                    <X className='mr-1 h-3 w-3' /> Return
                                  </Button>
                                </>
                              )}
                              {(editable || (canReview && !locked)) && (
                                <Button
                                  size='icon'
                                  variant='ghost'
                                  className='h-6 w-6'
                                  aria-label='Edit'
                                  onClick={() => setEditingId(entry.id)}
                                >
                                  <Pencil className='h-3 w-3' />
                                </Button>
                              )}
                              {(editable || (canReview && !locked)) && (
                                <Button
                                  size='icon'
                                  variant='ghost'
                                  className='h-6 w-6'
                                  aria-label='Delete'
                                  disabled={remove.isPending}
                                  onClick={() => {
                                    if (!window.confirm('Remove this entry?'))
                                      return
                                    run(
                                      () => remove.mutateAsync(entry.id),
                                      'Entry removed'
                                    )
                                  }}
                                >
                                  <Trash2 className='h-3 w-3' />
                                </Button>
                              )}
                            </div>
                            {entry.status === 'rejected' &&
                              entry.rejectionReason && (
                                <p className='mt-1 text-right text-[10px] text-destructive'>
                                  {entry.rejectionReason}
                                </p>
                              )}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {entries.length > 0 && (
          <p
            className='px-1 text-[11px] text-muted-foreground'
            data-testid='uat-dailylog-quantities-note'
          >
            Each row stands on its own in its item's unit and is not official
            progress: rows are never added up here. The Progress tab shows the
            installed figure per BOQ item once an approver accepts them.
          </p>
        )}
      </div>
    </section>
  )
}
