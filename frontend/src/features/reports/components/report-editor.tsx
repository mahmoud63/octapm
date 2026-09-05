import { useMemo, useState } from 'react'
import {
  CalendarClock,
  Download,
  Loader2,
  Play,
  Plus,
  Save,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AGGREGATE_FNS,
  NO_VALUE_OPERATORS,
  OPERATORS_BY_TYPE,
  OPERATOR_LABEL,
  downloadDefinitionExport,
  downloadReportExport,
  useCreateReport,
  useCreateReportRun,
  useDeleteReport,
  usePreviewReport,
  useUpdateReport,
  type ReportAggregate,
  type ReportColumn,
  type ReportDefinition,
  type ReportDefinitionInput,
  type ReportFilter,
  type ReportOperator,
  type ReportResult,
  type ReportSource,
} from '../hooks/use-report-builder'
import { ReportChart } from './report-chart'
import { ReportRuns } from './report-runs'
import { ReportSchedulesDialog } from './report-schedules-dialog'

const ALL = '__all'
const NONE = '__none'

export const blankDefinition = (
  source: ReportSource | null
): ReportDefinitionInput => ({
  name: '',
  description: '',
  source: source?.key ?? '',
  projectId: null,
  columns: source?.defaultColumns ?? [],
  filters: [],
  sort: source?.defaultSort ?? null,
  groupBy: null,
  aggregates: [{ fn: 'count' }],
  chart: { type: 'none', metric: 'count' },
  visibility: 'private',
})

export const definitionFrom = (
  report: ReportDefinition
): ReportDefinitionInput => ({
  name: report.name,
  description: report.description ?? '',
  source: report.source,
  projectId: report.projectId,
  columns: report.columns,
  filters: report.filters,
  sort: report.sort ?? null,
  groupBy: report.groupBy ?? null,
  aggregates: report.aggregates.length ? report.aggregates : [{ fn: 'count' }],
  chart: report.chart ?? { type: 'none', metric: 'count' },
  visibility: report.visibility,
})

const formatCell = (
  type: ReportColumn['type'],
  value: unknown,
  currency?: string | null
) => {
  if (value === null || value === undefined || value === '') return ''
  if (type === 'date') return String(value).slice(0, 10)
  if (type === 'money')
    return `${currency ? `${currency} ` : ''}${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (type === 'number')
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (type === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function FilterRow({
  filter,
  source,
  onChange,
  onRemove,
}: {
  filter: ReportFilter
  source: ReportSource
  onChange: (next: ReportFilter) => void
  onRemove: () => void
}) {
  const column =
    source.columns.find((item) => item.key === filter.field) ??
    source.columns[0]
  const operators = OPERATORS_BY_TYPE[column.type]
  const needsValue = !NO_VALUE_OPERATORS.includes(filter.op)
  const inputType =
    column.type === 'date' && !['last_days', 'next_days'].includes(filter.op)
      ? 'date'
      : column.type === 'number' ||
          column.type === 'money' ||
          ['last_days', 'next_days'].includes(filter.op)
        ? 'number'
        : 'text'
  const valueText = (index?: number) => {
    const raw =
      index === undefined
        ? filter.value
        : Array.isArray(filter.value)
          ? filter.value[index]
          : ''
    return raw === null || raw === undefined
      ? ''
      : Array.isArray(raw)
        ? raw.join(', ')
        : String(raw)
  }
  return (
    <div
      className='grid gap-1 rounded-md border p-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]'
      data-testid='uat-report-filter'
    >
      <Select
        value={filter.field}
        onValueChange={(field) => {
          const next = source.columns.find((item) => item.key === field)!
          onChange({
            field,
            op: OPERATORS_BY_TYPE[next.type][0],
            value: undefined,
          })
        }}
      >
        <SelectTrigger className='h-8 text-xs' aria-label='Field'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {source.columns.map((item) => (
            <SelectItem key={item.key} value={item.key}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filter.op}
        onValueChange={(op) =>
          onChange({
            ...filter,
            op: op as ReportOperator,
            value:
              filter.op === 'between' || op === 'between'
                ? undefined
                : filter.value,
          })
        }
      >
        <SelectTrigger className='h-8 text-xs' aria-label='Operator'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((op) => (
            <SelectItem key={op} value={op}>
              {OPERATOR_LABEL[op]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!needsValue ? (
        <span className='self-center text-xs text-muted-foreground'>—</span>
      ) : filter.op === 'between' ? (
        <div className='flex gap-1'>
          <Input
            type={inputType}
            className='h-8 text-xs'
            aria-label='From'
            value={valueText(0)}
            onChange={(e) =>
              onChange({
                ...filter,
                value: [
                  e.target.value,
                  Array.isArray(filter.value) ? filter.value[1] : '',
                ],
              })
            }
          />
          <Input
            type={inputType}
            className='h-8 text-xs'
            aria-label='To'
            value={valueText(1)}
            onChange={(e) =>
              onChange({
                ...filter,
                value: [
                  Array.isArray(filter.value) ? filter.value[0] : '',
                  e.target.value,
                ],
              })
            }
          />
        </div>
      ) : column.enum && (filter.op === 'eq' || filter.op === 'neq') ? (
        <Select
          value={valueText() || NONE}
          onValueChange={(value) =>
            onChange({ ...filter, value: value === NONE ? undefined : value })
          }
        >
          <SelectTrigger className='h-8 text-xs' aria-label='Value'>
            <SelectValue placeholder='Value' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {column.enum.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          type={inputType}
          className='h-8 text-xs'
          aria-label='Value'
          placeholder={
            filter.op === 'in' || filter.op === 'nin'
              ? 'a, b, c'
              : ['last_days', 'next_days'].includes(filter.op)
                ? 'days'
                : column.enum
                  ? column.enum.join(' | ')
                  : 'value'
          }
          value={valueText()}
          onChange={(e) =>
            onChange({
              ...filter,
              value:
                filter.op === 'in' || filter.op === 'nin'
                  ? e.target.value
                      .split(',')
                      .map((item) => item.trim())
                      .filter(Boolean)
                  : e.target.value,
            })
          }
        />
      )}
      <Button
        type='button'
        size='icon'
        variant='ghost'
        className='h-8 w-8'
        aria-label='Remove filter'
        onClick={onRemove}
      >
        <X className='h-3 w-3' />
      </Button>
    </div>
  )
}

/**
 * The builder: source, columns, filters, sort, grouping, chart; preview;
 * save / export / schedule / run & deliver.
 */
export function ReportEditor({
  sources,
  projects,
  initial,
  report,
  highlightRunId,
  onSaved,
  onDeleted,
}: {
  sources: ReportSource[]
  projects: Array<{ id: string; name: string; currency?: string | null }>
  initial: ReportDefinitionInput
  report: ReportDefinition | null
  highlightRunId?: string | null
  onSaved: (report: ReportDefinition) => void
  onDeleted: () => void
}) {
  const [draft, setDraft] = useState<ReportDefinitionInput>(initial)
  const [preview, setPreview] = useState<ReportResult | null>(null)
  const [offset, setOffset] = useState(0)
  const [schedulesOpen, setSchedulesOpen] = useState(false)
  const previewReport = usePreviewReport()
  const create = useCreateReport()
  const update = useUpdateReport()
  const remove = useDeleteReport()
  const createRun = useCreateReportRun()
  const canCreate = useCanPerform('report', 'create')
  const canExport = useCanPerform('report', 'export')
  const canSchedule = useCanPerform('report', 'update', 'report.schedule')
  const source = useMemo(
    () => sources.find((item) => item.key === draft.source) ?? null,
    [sources, draft.source]
  )
  const columnByKey = (key: string) =>
    source?.columns.find((column) => column.key === key)
  const currency =
    projects.find((project) => project.id === draft.projectId)?.currency ?? null
  const numericColumns =
    source?.columns.filter(
      (column) => column.type === 'number' || column.type === 'money'
    ) ?? []
  const canManage = !report || report.isOwner || canSchedule

  const set = <K extends keyof ReportDefinitionInput>(
    key: K,
    value: ReportDefinitionInput[K]
  ) => setDraft((current) => ({ ...current, [key]: value }))
  const changeSource = (key: string) => {
    const next = sources.find((item) => item.key === key)
    if (!next) return
    setDraft((current) => ({
      ...current,
      source: key,
      columns: next.defaultColumns,
      filters: [],
      sort: next.defaultSort,
      groupBy: null,
      aggregates: [{ fn: 'count' }],
      chart: { type: 'none', metric: 'count' },
    }))
    setPreview(null)
  }
  const cleanDefinition = (): ReportDefinitionInput => ({
    ...draft,
    filters: draft.filters.filter(
      (filter) =>
        NO_VALUE_OPERATORS.includes(filter.op) ||
        (filter.value !== undefined &&
          filter.value !== '' &&
          !(
            Array.isArray(filter.value) &&
            filter.value.every((item) => item === '' || item === undefined)
          ))
    ),
    aggregates: draft.aggregates.filter(
      (item) => item.fn === 'count' || item.field
    ),
  })

  const runPreview = async (nextOffset = 0) => {
    try {
      const definition = cleanDefinition()
      const result = await previewReport.mutateAsync({
        source: definition.source,
        projectId: definition.projectId,
        columns: definition.columns,
        filters: definition.filters,
        sort: definition.sort,
        groupBy: definition.groupBy,
        aggregates: definition.aggregates,
        chart: definition.chart,
        limit: 100,
        offset: nextOffset,
      })
      setPreview(result)
      setOffset(nextOffset)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const save = async (asNew = false) => {
    const definition = cleanDefinition()
    if (!definition.name.trim()) {
      toast.error('Give the report a name')
      return
    }
    try {
      const saved =
        report && !asNew
          ? await update.mutateAsync({
              reportId: report.id,
              payload: definition,
            })
          : await create.mutateAsync(definition)
      toast.success(report && !asNew ? 'Report saved' : 'Report created')
      onSaved(saved)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const exportNow = async (format: 'pdf' | 'xlsx') => {
    try {
      if (report) await downloadReportExport(report.id, format)
      else
        await downloadDefinitionExport(
          {
            ...cleanDefinition(),
            name: draft.name || source?.label || 'Report',
          },
          format
        )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  if (!source)
    return (
      <p className='text-sm text-muted-foreground'>Pick a source to start.</p>
    )

  return (
    <div className='space-y-4' data-testid='uat-report-editor'>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-1'>
          <Label htmlFor='rpt-name'>Name</Label>
          <Input
            id='rpt-name'
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder='Overdue RFIs by discipline'
            data-testid='uat-report-name'
          />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='rpt-desc'>Description</Label>
          <Input
            id='rpt-desc'
            value={draft.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
            placeholder='What this report answers'
          />
        </div>
      </div>
      <div className='grid gap-3 sm:grid-cols-3'>
        <div className='space-y-1'>
          <Label>Source</Label>
          <Select value={draft.source} onValueChange={changeSource}>
            <SelectTrigger data-testid='uat-report-source'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sources.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label>Projects</Label>
          <Select
            value={draft.projectId ?? ALL}
            onValueChange={(value) =>
              set('projectId', value === ALL ? null : value)
            }
          >
            <SelectTrigger data-testid='uat-report-scope'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All projects I can see</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label>Shared with</Label>
          <Select
            value={draft.visibility}
            onValueChange={(value) =>
              set('visibility', value as ReportDefinitionInput['visibility'])
            }
          >
            <SelectTrigger data-testid='uat-report-visibility'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='private'>Only me</SelectItem>
              <SelectItem value='project' disabled={!draft.projectId}>
                Everyone on the project
              </SelectItem>
              <SelectItem value='org'>Everyone in the organisation</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <section className='space-y-2'>
        <div className='flex items-center gap-2'>
          <p className='text-sm font-medium'>Columns</p>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            className='h-6 text-xs'
            onClick={() => set('columns', source.defaultColumns)}
          >
            Defaults
          </Button>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            className='h-6 text-xs'
            onClick={() =>
              set(
                'columns',
                source.columns.map((column) => column.key)
              )
            }
          >
            All
          </Button>
        </div>
        <div
          className='grid grid-cols-2 gap-1 rounded-md border p-2 text-xs sm:grid-cols-3 lg:grid-cols-4'
          data-testid='uat-report-columns'
        >
          {source.columns.map((column) => (
            <label key={column.key} className='flex items-center gap-2'>
              <Checkbox
                checked={draft.columns.includes(column.key)}
                onCheckedChange={(checked) =>
                  set(
                    'columns',
                    checked
                      ? [...draft.columns, column.key]
                      : draft.columns.filter((key) => key !== column.key)
                  )
                }
              />
              <span className={cn(column.computed && 'italic')}>
                {column.label}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className='space-y-2'>
        <div className='flex items-center gap-2'>
          <p className='text-sm font-medium'>Filters</p>
          <Button
            type='button'
            size='sm'
            variant='outline'
            className='h-6 text-xs'
            onClick={() =>
              set('filters', [
                ...draft.filters,
                {
                  field: source.columns[0].key,
                  op: OPERATORS_BY_TYPE[source.columns[0].type][0],
                },
              ])
            }
            data-testid='uat-report-add-filter'
          >
            <Plus className='mr-1 h-3 w-3' /> Add filter
          </Button>
        </div>
        {draft.filters.length === 0 && (
          <p className='text-xs text-muted-foreground'>
            No filters — every row the source has.
          </p>
        )}
        <div className='space-y-1'>
          {draft.filters.map((filter, index) => (
            <FilterRow
              key={index}
              filter={filter}
              source={source}
              onChange={(next) =>
                set(
                  'filters',
                  draft.filters.map((item, i) => (i === index ? next : item))
                )
              }
              onRemove={() =>
                set(
                  'filters',
                  draft.filters.filter((_, i) => i !== index)
                )
              }
            />
          ))}
        </div>
      </section>

      <section className='grid gap-3 lg:grid-cols-3'>
        <div className='space-y-1'>
          <Label>Sort</Label>
          <div className='flex gap-1'>
            <Select
              value={draft.sort?.field ?? NONE}
              onValueChange={(value) =>
                set(
                  'sort',
                  value === NONE
                    ? null
                    : { field: value, dir: draft.sort?.dir ?? 'asc' }
                )
              }
            >
              <SelectTrigger className='h-8 text-xs'>
                <SelectValue placeholder='Field' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Default</SelectItem>
                {source.columns.map((column) => (
                  <SelectItem key={column.key} value={column.key}>
                    {column.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={draft.sort?.dir ?? 'asc'}
              onValueChange={(value) =>
                draft.sort &&
                set('sort', { ...draft.sort, dir: value as 'asc' | 'desc' })
              }
            >
              <SelectTrigger className='h-8 w-24 text-xs'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='asc'>A → Z</SelectItem>
                <SelectItem value='desc'>Z → A</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className='space-y-1'>
          <Label>Group by</Label>
          <Select
            value={draft.groupBy ?? NONE}
            onValueChange={(value) =>
              set('groupBy', value === NONE ? null : value)
            }
          >
            <SelectTrigger
              className='h-8 text-xs'
              data-testid='uat-report-groupby'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No grouping</SelectItem>
              {source.columns.map((column) => (
                <SelectItem key={column.key} value={column.key}>
                  {column.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <div className='flex items-center gap-2'>
            <Label>Totals</Label>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              className='h-6 text-xs'
              disabled={!numericColumns.length}
              onClick={() =>
                set('aggregates', [
                  ...draft.aggregates,
                  { fn: 'sum', field: numericColumns[0]?.key },
                ])
              }
            >
              <Plus className='mr-1 h-3 w-3' /> Add
            </Button>
          </div>
          <div className='space-y-1'>
            {draft.aggregates.map((aggregate, index) => (
              <div key={index} className='flex gap-1'>
                <Select
                  value={aggregate.fn}
                  onValueChange={(value) =>
                    set(
                      'aggregates',
                      draft.aggregates.map((item, i) =>
                        i === index
                          ? {
                              fn: value as ReportAggregate['fn'],
                              field:
                                value === 'count'
                                  ? null
                                  : (item.field ?? numericColumns[0]?.key),
                            }
                          : item
                      )
                    )
                  }
                >
                  <SelectTrigger className='h-8 w-24 text-xs'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGGREGATE_FNS.map((fn) => (
                      <SelectItem key={fn} value={fn}>
                        {fn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {aggregate.fn !== 'count' && (
                  <Select
                    value={aggregate.field ?? NONE}
                    onValueChange={(value) =>
                      set(
                        'aggregates',
                        draft.aggregates.map((item, i) =>
                          i === index ? { ...item, field: value } : item
                        )
                      )
                    }
                  >
                    <SelectTrigger className='h-8 text-xs'>
                      <SelectValue placeholder='Field' />
                    </SelectTrigger>
                    <SelectContent>
                      {(aggregate.fn === 'min' || aggregate.fn === 'max'
                        ? source.columns
                        : numericColumns
                      ).map((column) => (
                        <SelectItem key={column.key} value={column.key}>
                          {column.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {index > 0 && (
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    className='h-8 w-8'
                    aria-label='Remove total'
                    onClick={() =>
                      set(
                        'aggregates',
                        draft.aggregates.filter((_, i) => i !== index)
                      )
                    }
                  >
                    <X className='h-3 w-3' />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-1'>
          <Label>Chart</Label>
          <Select
            value={draft.chart?.type ?? 'none'}
            onValueChange={(value) =>
              set('chart', {
                type: value as 'bar' | 'line' | 'pie' | 'none',
                metric: draft.chart?.metric ?? 'count',
              })
            }
          >
            <SelectTrigger
              className='h-8 text-xs'
              data-testid='uat-report-chart-type'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='none'>No chart</SelectItem>
              <SelectItem value='bar'>Bars per group</SelectItem>
              <SelectItem value='line'>Line per group</SelectItem>
              <SelectItem value='pie'>Share per group</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label>Chart metric</Label>
          <Select
            value={draft.chart?.metric ?? 'count'}
            onValueChange={(value) =>
              set('chart', { type: draft.chart?.type ?? 'none', metric: value })
            }
          >
            <SelectTrigger className='h-8 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='count'>Count</SelectItem>
              {draft.aggregates
                .filter((item) => item.fn !== 'count' && item.field)
                .map((item) => (
                  <SelectItem
                    key={`${item.fn}_${item.field}`}
                    value={`${item.fn}_${item.field}`}
                  >
                    {item.fn} of {columnByKey(item.field!)?.label ?? item.field}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <div className='flex flex-wrap gap-2' data-testid='uat-report-actions'>
        <Button
          size='sm'
          onClick={() => runPreview(0)}
          disabled={previewReport.isPending}
          data-testid='uat-report-preview'
        >
          {previewReport.isPending ? (
            <Loader2 className='mr-1 h-4 w-4 animate-spin' />
          ) : (
            <Play className='mr-1 h-4 w-4' />
          )}
          Preview
        </Button>
        {canCreate && canManage && (
          <Button
            size='sm'
            variant='outline'
            onClick={() => save(false)}
            disabled={create.isPending || update.isPending}
            data-testid='uat-report-save'
          >
            <Save className='mr-1 h-4 w-4' /> {report ? 'Save' : 'Save report'}
          </Button>
        )}
        {report && canCreate && (
          <Button
            size='sm'
            variant='ghost'
            onClick={() => save(true)}
            disabled={create.isPending}
          >
            Save as new
          </Button>
        )}
        {canExport && (
          <>
            <Button
              size='sm'
              variant='outline'
              onClick={() => exportNow('xlsx')}
              data-testid='uat-report-export-xlsx'
            >
              <Download className='mr-1 h-4 w-4' /> XLSX
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={() => exportNow('pdf')}
              data-testid='uat-report-export-pdf'
            >
              <Download className='mr-1 h-4 w-4' /> PDF
            </Button>
          </>
        )}
        {report && canExport && (
          <Button
            size='sm'
            variant='outline'
            disabled={createRun.isPending}
            data-testid='uat-report-run-deliver'
            onClick={async () => {
              try {
                const run = await createRun.mutateAsync({
                  reportId: report.id,
                  format: 'both',
                  deliver: true,
                })
                toast.success(`Rendered ${run.rowCount} rows and sent to you`)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {createRun.isPending ? (
              <Loader2 className='mr-1 h-4 w-4 animate-spin' />
            ) : (
              <Send className='mr-1 h-4 w-4' />
            )}
            Run & deliver
          </Button>
        )}
        {report && canSchedule && (
          <Button
            size='sm'
            variant='outline'
            onClick={() => setSchedulesOpen(true)}
            data-testid='uat-report-schedules-open'
          >
            <CalendarClock className='mr-1 h-4 w-4' /> Schedules
            {report.scheduleCount ? ` (${report.scheduleCount})` : ''}
          </Button>
        )}
        {report && canManage && (
          <Button
            size='sm'
            variant='ghost'
            className='ml-auto text-destructive'
            disabled={remove.isPending}
            onClick={async () => {
              if (!window.confirm(`Delete "${report.name}" and its schedules?`))
                return
              try {
                await remove.mutateAsync(report.id)
                toast.success('Report deleted')
                onDeleted()
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            <Trash2 className='mr-1 h-4 w-4' /> Delete
          </Button>
        )}
      </div>

      {preview && (
        <section className='space-y-3' data-testid='uat-report-preview-result'>
          <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
            <Badge variant='outline'>
              {preview.total.toLocaleString()} rows
            </Badge>
            <span>
              {preview.projects.queried} project
              {preview.projects.queried === 1 ? '' : 's'}
              {preview.projects.denied
                ? ` · ${preview.projects.denied} skipped (no permission there)`
                : ''}
            </span>
            {preview.truncated && (
              <Badge variant='destructive'>truncated at 5,000 rows</Badge>
            )}
            <span className='ml-auto'>
              {new Date(preview.generatedAt).toLocaleTimeString()}
            </span>
          </div>
          <ReportChart result={preview} chart={draft.chart} />
          {preview.groups && (
            <div className='overflow-x-auto rounded-md border'>
              <table className='w-full text-xs' data-testid='uat-report-groups'>
                <thead className='bg-muted/40'>
                  <tr>
                    <th className='p-1 text-left'>{preview.groupBy?.label}</th>
                    <th className='p-1 text-right'>Count</th>
                    {preview.aggregates
                      .filter((item) => item.fn !== 'count')
                      .map((item) => (
                        <th key={item.key} className='p-1 text-right'>
                          {item.label}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.groups.map((group) => (
                    <tr key={group.key} className='border-t'>
                      <td className='p-1'>{group.label}</td>
                      <td className='p-1 text-right tabular-nums'>
                        {group.count}
                      </td>
                      {preview.aggregates
                        .filter((item) => item.fn !== 'count')
                        .map((item) => (
                          <td
                            key={item.key}
                            className='p-1 text-right tabular-nums'
                          >
                            {formatCell(
                              columnByKey(item.field!)?.type ?? 'number',
                              group[item.key],
                              currency
                            )}
                          </td>
                        ))}
                    </tr>
                  ))}
                  <tr className='border-t font-medium'>
                    <td className='p-1'>Total</td>
                    <td className='p-1 text-right tabular-nums'>
                      {preview.totals.count}
                    </td>
                    {preview.aggregates
                      .filter((item) => item.fn !== 'count')
                      .map((item) => (
                        <td
                          key={item.key}
                          className='p-1 text-right tabular-nums'
                        >
                          {formatCell(
                            columnByKey(item.field!)?.type ?? 'number',
                            preview.totals[item.key],
                            currency
                          )}
                        </td>
                      ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <div className='overflow-x-auto rounded-md border'>
            <table className='w-full text-xs' data-testid='uat-report-rows'>
              <thead className='bg-muted/40'>
                <tr>
                  {!draft.projectId && (
                    <th className='p-1 text-left'>Project</th>
                  )}
                  {preview.columns.map((column) => (
                    <th
                      key={column.key}
                      className={cn(
                        'p-1 text-left',
                        (column.type === 'number' || column.type === 'money') &&
                          'text-right'
                      )}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={preview.columns.length + 1}
                      className='p-3 text-center text-muted-foreground'
                    >
                      No rows match.
                    </td>
                  </tr>
                )}
                {preview.rows.map((row) => (
                  <tr key={row.id} className='border-t'>
                    {!draft.projectId && (
                      <td className='p-1'>{row.projectName ?? ''}</td>
                    )}
                    {preview.columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          'p-1',
                          (column.type === 'number' ||
                            column.type === 'money') &&
                            'text-right tabular-nums'
                        )}
                      >
                        {formatCell(column.type, row[column.key], currency)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.total > preview.rows.length && (
            <div className='flex items-center gap-2 text-xs'>
              <Button
                size='sm'
                variant='outline'
                className='h-7'
                disabled={offset === 0 || previewReport.isPending}
                onClick={() => runPreview(Math.max(0, offset - 100))}
              >
                Previous
              </Button>
              <span>
                {offset + 1}–
                {Math.min(offset + preview.rows.length, preview.total)} of{' '}
                {preview.total}
              </span>
              <Button
                size='sm'
                variant='outline'
                className='h-7'
                disabled={
                  offset + preview.rows.length >= preview.total ||
                  previewReport.isPending
                }
                onClick={() => runPreview(offset + 100)}
              >
                Next
              </Button>
            </div>
          )}
        </section>
      )}

      {report && (
        <section className='space-y-2'>
          <p className='text-sm font-medium'>Runs</p>
          <ReportRuns reportId={report.id} highlightRunId={highlightRunId} />
        </section>
      )}
      {report && schedulesOpen && (
        <ReportSchedulesDialog
          reportId={report.id}
          reportName={report.name}
          open={schedulesOpen}
          onOpenChange={setSchedulesOpen}
        />
      )}
    </div>
  )
}
